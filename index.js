#!/usr/bin/env node
import { ethers } from "ethers";
import fs from "fs";
import blessed from "blessed";
import contrib from "blessed-contrib";

class ETHConsolidator {
  constructor() {
    this.RPC_ENDPOINTS = [
      "https://carrot.megaeth.com/rpc",
      "https://rpc.testnet.megaeth.com",
      "https://testnet.megaeth.io/rpc"
    ];
    this.CHAIN_ID = 6342;
    this.MIN_BALANCE = 0.0015;
    this.TX_DELAY_MS = 1000;
    this.successCount = 0;
    this.failedCount = 0;
    this.initUI();
  }

  initUI() {
    this.screen = blessed.screen({ smartCSR: true, fullUnicode: true });
    this.grid = new contrib.grid({ rows: 12, cols: 12, screen: this.screen });

    this.logBox = this.grid.set(0, 0, 6, 6, contrib.log, {
      label: " Transaction Logs ",
      border: { type: "line", fg: "cyan" },
      scrollable: true,
      scrollbar: { style: { bg: "blue" }, track: { bg: "black" } }
    });

    this.statusBox = this.grid.set(0, 6, 6, 6, contrib.log, {
      label: " Status Summary ",
      border: { type: "line", fg: "magenta" },
      scrollable: true,
      scrollbar: { style: { bg: "magenta" }, track: { bg: "black" } }
    });

    this.walletTable = this.grid.set(6, 0, 6, 12, contrib.table, {
      label: " Wallet Status ",
      border: { type: "line", fg: "cyan" },
      columnWidth: [20, 12, 12, 12, 12, 30],
      columnSpacing: 2
    });

    this.screen.key(["q", "C-c"], () => process.exit(0));
  }

  updateStatusBox(text) {
    this.statusBox.log(text);
    this.screen.render();
  }

  async connect() {
    for (const rpc of this.RPC_ENDPOINTS) {
      try {
        const provider = new ethers.JsonRpcProvider(rpc);
        await provider.getBlockNumber();
        this.provider = provider;
        this.log(`✓ Connected to ${rpc}`);
        return true;
      } catch (error) {
        this.log(`✗ Failed to connect to ${rpc}`);
      }
    }
    throw new Error("Could not connect to any RPC");
  }

  async loadConfig() {
    try {
      this.targetAddress = fs.readFileSync("target_address.txt", "utf-8").trim();
      if (!ethers.isAddress(this.targetAddress)) {
        throw new Error("Invalid target address format");
      }

      this.privateKeys = fs.readFileSync("private_keys.txt", "utf-8")
        .split("\n")
        .map(line => line.trim())
        .filter(line => line.length > 0);

      if (this.privateKeys.length === 0) {
        throw new Error("No private keys found");
      }
    } catch (error) {
      throw new Error(`Config error: ${error.message}`);
    }
  }

  log(message) {
    this.logBox.log(message);
    this.screen.render();
  }

  async processWallet(privateKey, index) {
    const wallet = new ethers.Wallet(privateKey, this.provider);
    const address = wallet.address;
    this.log(`\n[${index + 1}/${this.privateKeys.length}] Processing ${address}`);

    try {
      const currentBalance = await this.getBalance(address);
      this.log(`  Current Balance: ${currentBalance.toFixed(6)} ETH`);

      if (currentBalance <= this.MIN_BALANCE) {
        this.log(`  Skipping - needs minimum ${this.MIN_BALANCE} ETH`);
        this.updateTable(address, currentBalance, 0, "Skipped", currentBalance, "Low balance");
        return "skipped";
      }

      const transferAmount = currentBalance - this.MIN_BALANCE;
      this.log(`  Transfer Amount: ${transferAmount.toFixed(6)} ETH`);

      const tx = await wallet.sendTransaction({
        to: this.targetAddress,
        value: ethers.parseEther(transferAmount.toFixed(6)),
        gasLimit: 21000,
        chainId: this.CHAIN_ID,
        type: 2
      });

      const explorer = `https://megaexplorer.xyz/tx/${tx.hash}`;
      this.log(`  TX Hash: ${tx.hash}`);
      this.log(`  Explorer: ${explorer}`);

      await tx.wait();

      this.successCount++;
      this.updateTable(address, currentBalance, transferAmount, "Success", this.MIN_BALANCE, explorer);
      return "success";
    } catch (error) {
      const fallbackBalance = await this.getBalance(address).catch(() => 0);
      this.failedCount++;
      this.log(`  Error: ${error.message}`);
      this.updateTable(address, fallbackBalance, 0, "Failed", fallbackBalance, error.message.slice(0, 30));
      return "failed";
    }
  }

  async getBalance(address) {
    const balance = await this.provider.getBalance(address);
    return parseFloat(ethers.formatEther(balance));
  }

  updateTable(address, currentBalance, transferAmount, status, remainingBalance, info) {
    const shortAddr = address.slice(0, 6) + "..." + address.slice(-4);
    const statusColor =
      status === "Success"
        ? `{green-fg}${status}{/green-fg}`
        : status === "Failed"
        ? `{red-fg}${status}{/red-fg}`
        : `{yellow-fg}${status}{/yellow-fg}`;

    const data = this.walletTable.rows?.data || [];
    this.walletTable.setData({
      headers: ["Address", "Current", "Transfer", "Status", "Remaining", "Info"],
      data: [...data, [
        shortAddr,
        currentBalance.toFixed(6),
        transferAmount.toFixed(6),
        statusColor,
        remainingBalance.toFixed(6),
        info
      ]]
    });

    this.screen.render();
  }

  async run() {
    try {
      await this.connect();
      await this.loadConfig();

      this.log(`\n🔹 Target Address: ${this.targetAddress}`);
      this.log(`🔹 Found ${this.privateKeys.length} wallets to process`);

      for (let i = 0; i < this.privateKeys.length; i++) {
        await this.processWallet(this.privateKeys[i], i);
        if (i < this.privateKeys.length - 1) {
          await new Promise(res => setTimeout(res, this.TX_DELAY_MS));
        }
      }

      this.log("\n✅ Consolidation complete!");
    } catch (err) {
      this.log(`\n❌ Fatal Error: ${err.message}`);
    } finally {
      this.updateStatusBox(`Total Success: ${this.successCount}`);
      this.updateStatusBox(`Total Failed : ${this.failedCount}`);
      this.updateStatusBox(`Final Status : Completed`);
      this.log("\nPress 'q' or Ctrl+C to exit");
    }
  }
}

new ETHConsolidator().run();
