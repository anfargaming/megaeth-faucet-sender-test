#!/usr/bin/env node
import { ethers } from "ethers";
import fs from "fs";
import blessed from "blessed";
import contrib from "blessed-contrib";

class ETHConsolidator {
  constructor() {
    // Configuration with validation
    this.RPC_ENDPOINTS = [
      "https://carrot.megaeth.com/rpc",
      "https://rpc.testnet.megaeth.com", 
      "https://testnet.megaeth.io/rpc"
    ];
    this.CHAIN_ID = 6342;
    this.MIN_BALANCE = 0.0015; // ETH to leave in wallet
    this.TX_DELAY_MS = 1500; // ms between transactions
    this.GAS_LIMIT = 21000;
    this.MAX_RETRIES = 3;
    
    // State management
    this.stats = {
      processed: 0,
      success: 0,
      failed: 0,
      skipped: 0
    };
    
    this.initUI();
  }

  initUI() {
    try {
      this.screen = blessed.screen({
        smartCSR: true,
        fullUnicode: true,
        dockBorders: true
      });
      
      this.grid = new contrib.grid({
        rows: 12,
        cols: 12,
        screen: this.screen
      });

      // Main log view
      this.logBox = this.grid.set(0, 0, 6, 12, contrib.log, {
        label: " Transaction Logs ",
        border: { type: "line", fg: "cyan" },
        scrollable: true,
        scrollbar: {
          style: { bg: "blue" },
          track: { bg: "black" }
        }
      });

      // Wallet status table with all columns
      this.walletTable = this.grid.set(6, 0, 5, 12, contrib.table, {
        label: " Wallet Status ",
        border: { type: "line", fg: "cyan" },
        columnWidth: [20, 12, 12, 12, 12, 30],
        columnSpacing: 2,
        interactive: true
      });

      // Exit instructions
      this.grid.set(11, 0, 1, 12, blessed.text, {
        content: "{center}Press 'q' or Ctrl+C to exit{/center}",
        style: { fg: "cyan" }
      });

      this.screen.key(["q", "C-c"], () => {
        this.log("\nShutting down gracefully...");
        process.exit(0);
      });

    } catch (error) {
      console.error("UI initialization failed:", error);
      process.exit(1);
    }
  }

  async connect() {
    let lastError;
    for (const rpc of this.RPC_ENDPOINTS) {
      try {
        const provider = new ethers.JsonRpcProvider(rpc);
        // Verify connection and chain ID
        const network = await provider.getNetwork();
        if (network.chainId !== this.CHAIN_ID) {
          throw new Error(`Chain ID mismatch (expected ${this.CHAIN_ID}, got ${network.chainId})`);
        }
        this.provider = provider;
        this.log(`✓ Connected to ${rpc} (Chain ID: ${network.chainId})`);
        return true;
      } catch (error) {
        lastError = error;
        this.log(`✗ Failed to connect to ${rpc}: ${error.message}`);
      }
    }
    throw new Error(`All RPC connections failed. Last error: ${lastError.message}`);
  }

  async loadConfig() {
    try {
      // Validate target address file
      if (!fs.existsSync("target_address.txt")) {
        throw new Error("target_address.txt not found");
      }
      
      this.targetAddress = fs.readFileSync("target_address.txt", "utf-8").trim();
      if (!ethers.isAddress(this.targetAddress)) {
        throw new Error(`Invalid Ethereum address: ${this.targetAddress}`);
      }

      // Validate private keys file
      if (!fs.existsSync("private_keys.txt")) {
        throw new Error("private_keys.txt not found");
      }
      
      const keyFileContent = fs.readFileSync("private_keys.txt", "utf-8");
      this.privateKeys = keyFileContent
        .split("\n")
        .map(line => line.trim())
        .filter(line => line.length > 0);

      if (this.privateKeys.length === 0) {
        throw new Error("No valid private keys found");
      }

      // Validate each private key
      for (const key of this.privateKeys) {
        try {
          new ethers.Wallet(key); // This will throw if invalid
        } catch {
          throw new Error(`Invalid private key format: ${key.slice(0, 8)}...`);
        }
      }

    } catch (error) {
      throw new Error(`Configuration error: ${error.message}`);
    }
  }

  log(message) {
    try {
      if (this.logBox) {
        this.logBox.log(message);
        this.screen.render();
      } else {
        console.log(message); // Fallback if UI fails
      }
    } catch (error) {
      console.error("Logging failed:", error);
    }
  }

  async getBalanceWithRetry(address, retries = this.MAX_RETRIES) {
    let lastError;
    for (let i = 0; i < retries; i++) {
      try {
        const balance = await this.provider.getBalance(address);
        return {
          wei: balance,
          eth: parseFloat(ethers.formatEther(balance))
        };
      } catch (error) {
        lastError = error;
        if (i < retries - 1) {
          await new Promise(r => setTimeout(r, 1000 * (i + 1)));
          this.log(`Retrying balance check (attempt ${i + 1})...`);
        }
      }
    }
    throw new Error(`Balance check failed after ${retries} attempts: ${lastError.message}`);
  }

  async sendTransactionWithRetry(wallet, txParams, retries = this.MAX_RETRIES) {
    let lastError;
    for (let i = 0; i < retries; i++) {
      try {
        const tx = await wallet.sendTransaction(txParams);
        const receipt = await tx.wait();
        return {
          tx,
          receipt
        };
      } catch (error) {
        lastError = error;
        if (i < retries - 1) {
          // Check if error is non-retryable
          if (error.code === "INSUFFICIENT_FUNDS") {
            throw error; // Don't retry insufficient funds
          }
          await new Promise(r => setTimeout(r, 2000 * (i + 1)));
          this.log(`Retrying transaction (attempt ${i + 1})...`);
        }
      }
    }
    throw new Error(`Transaction failed after ${retries} attempts: ${lastError.message}`);
  }

  async processWallet(privateKey, index) {
    const wallet = new ethers.Wallet(privateKey, this.provider);
    const address = wallet.address;
    this.stats.processed++;
    
    this.log(`\n[${index + 1}/${this.privateKeys.length}] Processing ${address}`);
    
    try {
      // Get current balance with retry logic
      const { eth: currentBalance } = await this.getBalanceWithRetry(address);
      this.log(`  Current Balance: ${currentBalance.toFixed(6)} ETH`);

      if (currentBalance <= this.MIN_BALANCE) {
        this.log(`  Skipping - needs minimum ${this.MIN_BALANCE} ETH`);
        this.stats.skipped++;
        this.updateTable(
          address,
          currentBalance.toFixed(6),
          "0.000000",
          "Skipped",
          currentBalance.toFixed(6),
          "Low balance"
        );
        return "skipped";
      }

      // Calculate transfer amount (leave MIN_BALANCE)
      const transferAmount = currentBalance - this.MIN_BALANCE;
      this.log(`  Transfer Amount: ${transferAmount.toFixed(6)} ETH`);

      // Get current gas prices
      const feeData = await this.provider.getFeeData();
      const maxFeePerGas = feeData.maxFeePerGas * 2n; // Add buffer
      const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas * 2n;

      // Send transaction with retry logic
      const { tx, receipt } = await this.sendTransactionWithRetry(wallet, {
        to: this.targetAddress,
        value: ethers.parseEther(transferAmount.toFixed(6)),
        gasLimit: this.GAS_LIMIT,
        maxFeePerGas,
        maxPriorityFeePerGas,
        chainId: this.CHAIN_ID,
        type: 2
      });

      this.log(`  TX Hash: ${tx.hash}`);
      this.log(`  Block: ${receipt.blockNumber}`);
      this.log(`  Gas Used: ${receipt.gasUsed.toString()}`);

      this.stats.success++;
      this.updateTable(
        address,
        currentBalance.toFixed(6),
        transferAmount.toFixed(6),
        "Success",
        this.MIN_BALANCE.toFixed(6),
        `TX: ${tx.hash.slice(0, 12)}...`
      );

      return "success";

    } catch (error) {
      this.log(`  Error: ${error.message}`);
      this.stats.failed++;
      
      // Try to get current balance for the table
      let currentBalance = 0;
      try {
        const balance = await this.getBalanceWithRetry(address, 1);
        currentBalance = balance.eth;
      } catch {}

      this.updateTable(
        address,
        currentBalance.toFixed(6),
        "0.000000",
        "Failed",
        currentBalance.toFixed(6),
        error.message.split("(")[0].slice(0, 20) + "..."
      );

      return "failed";
    }
  }

  updateTable(address, currentBalance, transferAmount, status, remainingBalance, info) {
    try {
      const shortAddress = address.slice(0, 6) + "..." + address.slice(-4);
      
      // Initialize table headers if first row
      if (!this.walletTable.rows) {
        this.walletTable.setData({
          headers: [
            "Address", 
            "Current (ETH)", 
            "Transfer (ETH)", 
            "Status", 
            "Remaining (ETH)", 
            "Info"
          ],
          data: []
        });
      }
      
      // Color coding for status
      let statusDisplay;
      switch (status) {
        case "Success":
          statusDisplay = `{green-fg}${status}{/green-fg}`;
          break;
        case "Failed":
          statusDisplay = `{red-fg}${status}{/red-fg}`;
          break;
        case "Skipped":
          statusDisplay = `{yellow-fg}${status}{/yellow-fg}`;
          break;
        default:
          statusDisplay = status;
      }

      this.walletTable.addRow([
        shortAddress,
        currentBalance,
        transferAmount,
        statusDisplay,
        remainingBalance,
        info
      ]);
      
      this.screen.render();
    } catch (error) {
      console.error("Table update failed:", error);
    }
  }

  async run() {
    try {
      this.log("Starting MEGA ETH Consolidator...");
      
      // Phase 1: Connect to network
      try {
        await this.connect();
      } catch (error) {
        throw new Error(`Network connection failed: ${error.message}`);
      }
      
      // Phase 2: Load configuration
      try {
        await this.loadConfig();
        this.log(`✓ Loaded configuration`);
        this.log(`  Target Address: ${this.targetAddress}`);
        this.log(`  Wallets Found: ${this.privateKeys.length}`);
      } catch (error) {
        throw new Error(`Configuration failed: ${error.message}`);
      }
      
      // Phase 3: Process wallets
      for (let i = 0; i < this.privateKeys.length; i++) {
        await this.processWallet(this.privateKeys[i], i);
        
        // Add delay between transactions except the last one
        if (i < this.privateKeys.length - 1) {
          await new Promise(r => setTimeout(r, this.TX_DELAY_MS));
        }
      }
      
      // Final report
      this.log("\n┌──────────────────────────────┐");
      this.log("│       Consolidation Complete      │");
      this.log("├──────────────────────────────┤");
      this.log(`│ Processed: ${this.stats.processed.toString().padEnd(10)} │`);
      this.log(`│ Success:   ${this.stats.success.toString().padEnd(10)} │`);
      this.log(`│ Failed:    ${this.stats.failed.toString().padEnd(10)} │`);
      this.log(`│ Skipped:   ${this.stats.skipped.toString().padEnd(10)} │`);
      this.log("└──────────────────────────────┘");

    } catch (error) {
      this.log(`\n❌ Fatal Error: ${error.message}`);
      process.exitCode = 1;
    } finally {
      this.log("\nPress 'q' or Ctrl+C to exit");
      // Keep process alive for UI interaction
      await new Promise(() => {});
    }
  }
}

// Error handling for the main process
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
  process.exit(1);
});

// Run the application
new ETHConsolidator().run();
