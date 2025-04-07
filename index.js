#!/usr/bin/env node
import { ethers } from "ethers";
import fs from "fs";
import dotenv from "dotenv";
import blessed from "blessed";
import contrib from "blessed-contrib";

dotenv.config();

// Configuration
const RPC_ENDPOINTS = [
  "https://carrot.megaeth.com/rpc",
  "https://rpc.testnet.megaeth.com",
  "https://testnet.megaeth.io/rpc",
];
const CHAIN_ID = 6342;
const GAS_LIMIT = 21000;
const MIN_BALANCE = 0.001; // Minimum ETH to leave in wallet
const TX_DELAY_MS = 1000; // Delay between transactions

class ETHConsolidator {
  constructor() {
    this.provider = null;
    this.targetAddress = "";
    this.privateKeys = [];
    this.stats = {
      success: 0,
      failed: 0,
      skipped: 0
    };
    this.transactions = [];
    this.initUI();
  }

  initUI() {
    this.screen = blessed.screen({ smartCSR: true });
    this.grid = new contrib.grid({ rows: 12, cols: 12, screen: this.screen });

    this.logBox = this.grid.set(0, 0, 6, 6, contrib.log, {
      label: " Transaction Logs ",
      fg: "green",
      border: { type: "line", fg: "cyan" },
      scrollbar: { ch: " ", inverse: true }
    });

    this.summaryBox = this.grid.set(0, 6, 6, 6, blessed.box, {
      label: " Summary ",
      tags: true,
      border: { type: "line", fg: "cyan" },
      style: { fg: "white" }
    });

    this.walletTable = this.grid.set(6, 0, 4, 12, contrib.table, {
      label: " Wallet Status ",
      border: { type: "line", fg: "cyan" },
      columnSpacing: 2,
      columnWidth: [42, 12, 10, 60]
    });

    this.lineChart = this.grid.set(10, 0, 2, 12, contrib.line, {
      label: " Transaction Progress ",
      showLegend: true,
      legend: { width: 15 },
      style: { line: "yellow", text: "green" }
    });

    this.exitInfo = this.grid.set(11, 0, 1, 12, blessed.box, {
      content: "{center}Press 'q' or Ctrl+C to exit{/center}",
      style: { fg: "cyan" }
    });

    this.screen.key(["q", "C-c"], () => process.exit(0));
    this.updateSummary();
    this.screen.render();
  }

  async connect() {
    for (const rpc of RPC_ENDPOINTS) {
      try {
        const provider = new ethers.JsonRpcProvider(rpc);
        await provider.getBlockNumber(); // Test connection
        this.provider = provider;
        this.log(`Connected to ${rpc}`);
        return;
      } catch (error) {
        this.log(`Failed to connect to ${rpc}: ${error.message}`);
      }
    }
    throw new Error("Unable to connect to any RPC endpoint");
  }

  async loadConfig() {
    try {
      // Load target address
      this.targetAddress = fs.readFileSync("target_address.txt", "utf-8").trim();
      if (!ethers.isAddress(this.targetAddress)) {
        throw new Error("Invalid target address format");
      }

      // Load private keys
      const keys = fs.readFileSync("private_keys.txt", "utf-8")
        .split("\n")
        .map(line => line.trim())
        .filter(Boolean);

      if (keys.length === 0) {
        throw new Error("No private keys found");
      }
      this.privateKeys = keys;
    } catch (error) {
      throw new Error(`Config error: ${error.message}`);
    }
  }

  log(message) {
    this.logBox.log(message);
    this.screen.render();
  }

  updateSummary() {
    const total = this.stats.success + this.stats.failed + this.stats.skipped;
    const content = [
      `{green-fg}✅ Success: {white-fg}${this.stats.success}{/white-fg}{/green-fg}`,
      `{red-fg}❌ Failed: {white-fg}${this.stats.failed}{/white-fg}{/red-fg}`,
      `{yellow-fg}⚠️ Skipped: {white-fg}${this.stats.skipped}{/white-fg}{/yellow-fg}`,
      `{cyan-fg}📊 Total: {white-fg}${total}{/white-fg}{/cyan-fg}`,
      `{blue-fg}🎯 Target: {white-fg}${this.targetAddress}{/white-fg}{/blue-fg}`
    ].join("\n");
    
    this.summaryBox.setContent(content);
    this.screen.render();
  }

  async getBalance(address) {
    try {
      const balance = await this.provider.getBalance(address);
      return Number(ethers.formatEther(balance));
    } catch (error) {
      this.log(`Balance check failed: ${error.message}`);
      throw error;
    }
  }

  async sendTransaction(wallet, index) {
    const address = wallet.address;
    this.log(`\n[${index + 1}/${this.privateKeys.length}] Processing ${address}`);

    try {
      const balance = await this.getBalance(address);
      this.log(`  Balance: ${balance.toFixed(6)} ETH`);

      if (balance <= MIN_BALANCE) {
        this.log("  Skipping - insufficient balance");
        this.stats.skipped++;
        this.updateTable(address, "0", "Skipped", "Low balance");
        return;
      }

      const amount = balance - MIN_BALANCE;
      const tx = await wallet.sendTransaction({
        to: this.targetAddress,
        value: ethers.parseEther(amount.toFixed(6)),
        gasLimit: GAS_LIMIT,
        maxFeePerGas: ethers.parseUnits("0.0025", "gwei"),
        maxPriorityFeePerGas: ethers.parseUnits("0.001", "gwei"),
        chainId: CHAIN_ID,
        type: 2
      });

      this.log(`  Sending: ${amount.toFixed(6)} ETH`);
      this.log(`  TX Hash: ${tx.hash}`);
      this.log(`  Explorer: https://explorer.megaeth.com/tx/${tx.hash}`);

      const receipt = await tx.wait();
      this.log(`  Confirmed in block: ${receipt.blockNumber}`);

      this.stats.success++;
      this.updateTable(
        address,
        amount.toFixed(6),
        "Success",
        `https://explorer.megaeth.com/tx/${tx.hash}`
      );
    } catch (error) {
      this.log(`  Error: ${error.message}`);
      this.stats.failed++;
      this.updateTable(
        address,
        "0",
        "Failed",
        error.message.length > 40 ? error.message.substring(0, 40) + "..." : error.message
      );
    }
  }

  updateTable(address, amount, status, info) {
    this.transactions.push([address, amount, status, info]);
    this.walletTable.setData({
      headers: ["Address", "Amount", "Status", "Info"],
      data: this.transactions
    });

    this.lineChart.setData([{
      title: "Progress",
      x: Array.from({ length: this.transactions.length }, (_, i) => `${i + 1}`),
      y: this.transactions.map((_, i) => i + 1)
    }]);

    this.updateSummary();
    this.screen.render();
  }

  async run() {
    try {
      await this.connect();
      await this.loadConfig();
      
      this.log("\nStarting MEGA ETH Consolidator...");
      this.log(`Target Address: ${this.targetAddress}`);
      this.log(`Found ${this.privateKeys.length} wallets to process`);

      for (let i = 0; i < this.privateKeys.length; i++) {
        const wallet = new ethers.Wallet(this.privateKeys[i], this.provider);
        await this.sendTransaction(wallet, i);
        
        if (i < this.privateKeys.length - 1) {
          await new Promise(resolve => setTimeout(resolve, TX_DELAY_MS));
        }
      }

      this.log("\nConsolidation complete!");
      this.log(`✅ Success: ${this.stats.success}`);
      this.log(`❌ Failed: ${this.stats.failed}`);
      this.log(`⚠️ Skipped: ${this.stats.skipped}`);
    } catch (error) {
      this.log(`\nFatal error: ${error.message}`);
      process.exit(1);
    }
  }
}

// Run the application
const consolidator = new ETHConsolidator();
consolidator.run();
