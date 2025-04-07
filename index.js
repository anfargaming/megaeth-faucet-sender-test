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
    this.walletData = [];
    this.initUI();
  }

  initUI() {
    this.screen = blessed.screen({ smartCSR: true, fullUnicode: true });

    this.grid = new contrib.grid({ rows: 12, cols: 12, screen: this.screen });

    this.logBox = this.grid.set(0, 0, 6, 12, contrib.log, {
      label: " Transaction Logs ",
      border: { type: "line", fg: "cyan" },
      scrollable: true,
      scrollbar: { style: { bg: "blue" }, track: { bg: "black" } }
    });

    this.walletTable = this.grid.set(6, 0, 5, 12, contrib.table, {
      label: " Wallet Status ",
      border: { type: "line", fg: "cyan" },
      columnSpacing: 2,
      columnWidth: [20, 12, 12, 12, 12, 45]
    });

    this.walletTable.setData({
      headers: ["Address", "Current", "Transfer", "Status", "Remaining", "Info"],
      data: []
    });

    this.screen.key(["q", "C-c"], () => process.exit(0));
  }

  log(message) {
    this.logBox.log(message);
    this.screen.render();
  }

  async connect() {
    for (const rpc of this.RPC_ENDPOINTS) {
      try {
        const provider = new ethers.JsonRpcProvider(rpc);
        await provider.getBlockNumber();
        this.provider = provider;
        this.log(`✓ Connected to ${rpc}`);
        return;
      } catch {
        this.log(`✗ Failed to connect to ${rpc}`);
      }
    }
    throw new Error("Could not connect to any RPC");
  }

  async loadConfig() {
    try {
      this.targetAddress = fs.readFileSync("target_address.txt", "utf-8").trim();
      if (!ethers.isAddress(this.targetAddress)) throw new Error("Invalid target address format");

      this.privateKeys = fs.readFileSync("private_keys.txt", "utf-8")
        .split("\n")
        .map(line => line.trim())
        .filter(Boolean);

      if (this.privateKeys.length === 0) throw new Error("No private keys found");
    } catch (error) {
      throw new Error(`Config error: ${error.message}`);
    }
  }

  async getBalance(address) {
    const balance = await this.provider.getBalance(address);
    return parseFloat(ethers.formatEther(balance));
  }

  updateTable() {
    this.walletTable.setData({
      headers: ["Address", "Current", "Transfer", "Status", "Remaining", "Info"],
      data: this.walletData
    });
    this.screen.render();
  }

  async processWallet(privateKey, index) {
    const wallet = new ethers.Wallet(privateKey, this.provider);
    const address = wallet.address;
    const shortAddress = address.slice(0, 6) + "..." + address.slice(-4);
    this.log(`\n[${index + 1}/${this.privateKeys.length}] Processing ${address}`);

    try {
      const currentBalance = await this.getBalance(address);
      this.log(`  Current Balance: ${currentBalance.toFixed(6)} ETH`);

      if (currentBalance <= this.MIN_BALANCE) {
        this.log(`  Skipping - needs minimum ${this.MIN_BALANCE} ETH`);
        this.walletData.push([
          shortAddress,
          currentBalance.toFixed(6),
          "0.000000",
          "{yellow-fg}Skipped{/yellow-fg}",
          currentBalance.toFixed(6),
          "Low balance"
        ]);
        this.updateTable();
        return;
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

      this.log(`  TX Hash: ${tx.hash}`);
      await tx.wait();
      this.log(`  Transaction confirmed`);

      const explorerLink = `https://explorer.megaeth.io/tx/${tx.hash}`;
      this.walletData.push([
        shortAddress,
        currentBalance.toFixed(6),
        transferAmount.toFixed(6),
        "{green-fg}Success{/green-fg}",
        this.MIN_BALANCE.toFixed(6),
        explorerLink
      ]);
    } catch (error) {
      const currentBalance = await this.getBalance(address).catch(() => 0);
      this.walletData.push([
        shortAddress,
        currentBalance.toFixed(6),
        "0.000000",
        "{red-fg}Failed{/red-fg}",
        currentBalance.toFixed(6),
        error.message.split("(")[0].slice(0, 40) + "..."
      ]);
      this.log(`  Error: ${error.message}`);
    }

    this.updateTable();
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
          await new Promise(resolve => setTimeout(resolve, this.TX_DELAY_MS));
        }
      }

      this.log("\n✅ Consolidation complete!");
    } catch (error) {
      this.log(`\n❌ Fatal error: ${error.message}`);
    } finally {
      this.log("\nPress 'q' or Ctrl+C to exit");
    }
  }
}

new ETHConsolidator().run();
