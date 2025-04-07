#!/usr/bin/env node
import { ethers } from "ethers";
import fs from "fs";
import blessed from "blessed";
import contrib from "blessed-contrib";

class ETHConsolidator {
  constructor() {
    this.RPC_ENDPOINTS = [
      "https://carrot.megaeth.com/rpc"
    ];
    this.CHAIN_ID = 6342;
    this.TX_DELAY_MS = 1000;
    this.successCount = 0;
    this.failCount = 0;
    this.skippedCount = 0;
    this.tableData = [];
    this.initUI();
  }

  initUI() {
    this.screen = blessed.screen({ smartCSR: true });
    this.grid = new contrib.grid({ rows: 12, cols: 12, screen: this.screen });

    this.logBox = this.grid.set(0, 0, 8, 8, contrib.log, {
      label: " Transaction Logs ",
      border: { type: "line", fg: "cyan" },
      scrollbar: { style: { bg: "blue" } },
    });

    this.walletTable = this.grid.set(8, 0, 4, 8, contrib.table, {
      label: " Wallet Status ",
      columnWidth: [20, 12, 12, 12, 12, 34],
      columnSpacing: 2,
      border: { type: "line", fg: "cyan" },
    });

    this.statusBox = this.grid.set(0, 8, 12, 4, blessed.box, {
      label: " Final Status ",
      border: { type: "line", fg: "cyan" },
      tags: true,
      content: "",
      style: {
        fg: "white",
        bg: "black",
        border: { fg: "cyan" },
      },
    });

    this.screen.key(["q", "C-c"], () => process.exit(0));
  }

  log(message) {
    this.logBox.log(message);
    this.screen.render();
  }

  updateTable(address, currentBalance, transferAmount, status, remaining, info) {
    const shortAddress = address.slice(0, 6) + "..." + address.slice(-4);
    let statusColor = status;
    if (status === "Success") statusColor = `{green-fg}${status}{/green-fg}`;
    else if (status === "Failed") statusColor = `{red-fg}${status}{/red-fg}`;
    else statusColor = `{yellow-fg}${status}{/yellow-fg}`;

    this.tableData.push([
      shortAddress,
      currentBalance,
      transferAmount,
      statusColor,
      remaining,
      info,
    ]);

    this.walletTable.setData({
      headers: ["Address", "Current", "Transfer", "Status", "Remain", "Info"],
      data: this.tableData,
    });

    this.updateStatusBox();
    this.screen.render();
  }

  updateStatusBox() {
    const total = this.successCount + this.failCount + this.skippedCount;
    this.statusBox.setContent(
      `{bold}Total Success:{/bold} ${this.successCount}\n` +
      `{bold}Total Failed:{/bold} ${this.failCount}\n` +
      `{bold}Total Skipped:{/bold} ${this.skippedCount}\n` +
      `{bold}Final Status:{/bold} ${total === this.privateKeys?.length ? "Completed" : "Processing..."}\n\n` +
      `Press {bold}q{/bold} or {bold}Ctrl+C{/bold} to exit`
    );
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
    throw new Error("Couldn't connect to any RPC");
  }

  async loadConfig() {
    try {
      this.targetAddress = fs.readFileSync("target_address.txt", "utf-8").trim();
      if (!ethers.isAddress(this.targetAddress)) throw new Error("Invalid target address");

      this.privateKeys = fs.readFileSync("private_keys.txt", "utf-8")
        .split("\n")
        .map(x => x.trim())
        .filter(Boolean);
      if (this.privateKeys.length === 0) throw new Error("No private keys found");
    } catch (err) {
      throw new Error(`Config error: ${err.message}`);
    }
  }

  async getBalance(address) {
    const balance = await this.provider.getBalance(address);
    return balance;
  }

  async processWallet(privateKey, index) {
    const wallet = new ethers.Wallet(privateKey, this.provider);
    const address = wallet.address;

    this.log(`\n[${index + 1}/${this.privateKeys.length}] Processing ${address}`);

    try {
      const balance = await this.getBalance(address);
      this.log(`  Current Balance: ${ethers.formatEther(balance)} ETH`);

      if (balance <= 0n) {
        this.log(`  Skipping - balance is zero`);
        this.skippedCount++;
        this.updateTable(address, "0.000000", "0.000000", "Skipped", "0.000000", "Zero balance");
        return;
      }

      const txRequest = {
        to: this.targetAddress,
        value: balance,
        gasLimit: 21000,
        chainId: this.CHAIN_ID,
        type: 2,
      };

      const populated = await wallet.populateTransaction(txRequest);
      const estimatedGasFee = (populated.maxFeePerGas + populated.maxPriorityFeePerGas) * 21000n;

      const sendable = balance - estimatedGasFee;
      if (sendable <= 0n) {
        this.log(`  Not enough to cover gas. Needed: ${ethers.formatEther(estimatedGasFee)} ETH`);
        this.skippedCount++;
        this.updateTable(address, ethers.formatEther(balance), "0.000000", "Skipped", ethers.formatEther(balance), "Not enough gas");
        return;
      }

      const tx = await wallet.sendTransaction({
        to: this.targetAddress,
        value: sendable,
        chainId: this.CHAIN_ID,
        type: 2,
        gasLimit: 21000,
        maxFeePerGas: populated.maxFeePerGas,
        maxPriorityFeePerGas: populated.maxPriorityFeePerGas,
      });

      this.log(`  TX Hash: ${tx.hash}`);
      const explorer = `https://megaexplorer.xyz/tx/${tx.hash}`;
      this.log(`  Explorer: ${explorer}`);

      await tx.wait();
      this.log(`  Transaction confirmed`);

      this.successCount++;
      this.updateTable(
        address,
        ethers.formatEther(balance),
        ethers.formatEther(sendable),
        "Success",
        ethers.formatEther(balance - sendable),
        `🔗 ${explorer}`
      );
    } catch (err) {
      this.failCount++;
      this.log(`  ❌ Error: ${err.message}`);
      this.updateTable(address, "??", "0.000000", "Failed", "??", err.message.slice(0, 30));
    }
  }

  async run() {
    try {
      await this.connect();
      await this.loadConfig();

      this.log(`\n🔹 Target Address: ${this.targetAddress}`);
      this.log(`🔹 Found ${this.privateKeys.length} wallets to process\n`);

      for (let i = 0; i < this.privateKeys.length; i++) {
        await this.processWallet(this.privateKeys[i], i);
        if (i < this.privateKeys.length - 1) {
          await new Promise(r => setTimeout(r, this.TX_DELAY_MS));
        }
      }

      this.log("\n✅ Consolidation complete!");
    } catch (err) {
      this.log(`\n❌ Fatal Error: ${err.message}`);
    } finally {
      this.updateStatusBox();
    }
  }
}

new ETHConsolidator().run();
