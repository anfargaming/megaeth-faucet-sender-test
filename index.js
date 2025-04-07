#!/usr/bin/env node
import { ethers } from "ethers";
import fs from "fs";
import blessed from "blessed";
import contrib from "blessed-contrib";

class ETHConsolidator {
  constructor() {
    this.RPC_ENDPOINT = "https://carrot.megaeth.com/rpc";
    this.MIN_GAS_BUFFER = 21000; // minimum gas limit
    this.successCount = 0;
    this.failCount = 0;
    this.skippedCount = 0;
    this.tableData = [];
    this.initUI();
  }

  initUI() {
    this.screen = blessed.screen({ smartCSR: true });
    this.grid = new contrib.grid({ rows: 12, cols: 12, screen: this.screen });

    this.logBox = this.grid.set(0, 0, 12, 6, contrib.log, {
      label: " Transaction Logs ",
      border: { type: "line", fg: "cyan" },
      scrollbar: { style: { bg: "blue" } },
    });

    this.walletTable = this.grid.set(0, 6, 9, 6, contrib.table, {
      label: " Wallet Status ",
      columnWidth: [20, 12, 12, 12, 12, 34],
      columnSpacing: 2,
      border: { type: "line", fg: "cyan" },
    });

    this.statusBox = this.grid.set(9, 6, 3, 6, blessed.box, {
      label: " Final Status ",
      border: { type: "line", fg: "cyan" },
      tags: true,
      content: "",
      style: { fg: "white", bg: "black", border: { fg: "cyan" } },
    });

    this.screen.key(["q", "C-c"], () => process.exit(0));
  }

  log(message) {
    this.logBox.log(message);
    this.screen.render();
  }

  updateTable(address, currentBalance, transferAmount, status, remaining, info) {
    const shortAddr = address.slice(0, 6) + "..." + address.slice(-4);
    const colorMap = {
      Success: `{green-fg}${status}{/green-fg}`,
      Failed: `{red-fg}${status}{/red-fg}`,
      Skipped: `{yellow-fg}${status}{/yellow-fg}`,
    };

    this.tableData.push([
      shortAddr,
      currentBalance,
      transferAmount,
      colorMap[status] || status,
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
      `{bold}Final Status:{/bold} ${total === this.privateKeys?.length ? "✅ Done" : "Processing..."}` +
      `\n\nPress 'q' or Ctrl+C to exit`
    );
  }

  async connect() {
    try {
      this.provider = new ethers.JsonRpcProvider(this.RPC_ENDPOINT);
      await this.provider.getBlockNumber();
      this.log(`✓ Connected to ${this.RPC_ENDPOINT}`);
    } catch (err) {
      throw new Error(`Failed to connect to RPC: ${err.message}`);
    }
  }

  async loadConfig() {
    try {
      this.targetAddress = fs.readFileSync("target_address.txt", "utf-8").trim();
      if (!ethers.isAddress(this.targetAddress)) throw new Error("Invalid target address");

      this.privateKeys = fs.readFileSync("private_keys.txt", "utf-8")
        .split("\n").map(x => x.trim()).filter(Boolean);
      if (this.privateKeys.length === 0) throw new Error("No private keys found");
    } catch (err) {
      throw new Error(`Config error: ${err.message}`);
    }
  }

  async getBalance(address) {
    const balance = await this.provider.getBalance(address);
    return parseFloat(ethers.formatEther(balance));
  }

  async processWallet(pk, index) {
    const wallet = new ethers.Wallet(pk, this.provider);
    const address = wallet.address;
    this.log(`\n[${index + 1}/${this.privateKeys.length}] Processing ${address}`);

    try {
      const balance = await this.getBalance(address);
      this.log(`  Current Balance: ${balance.toFixed(6)} ETH`);

      const feeData = await this.provider.getFeeData();
      const estGas = BigInt(feeData.gasPrice ?? 1n) * 21000n;
      const estGasEth = parseFloat(ethers.formatEther(estGas));

      if (balance <= estGasEth) {
        this.log(`  Skipping - Not enough for gas (${estGasEth.toFixed(6)} ETH needed)`);
        this.skippedCount++;
        this.updateTable(address, balance.toFixed(6), "0.000000", "Skipped", balance.toFixed(6), "Insufficient gas");
        return;
      }

      const sendAmount = balance - estGasEth;
      const tx = await wallet.sendTransaction({
        to: this.targetAddress,
        value: ethers.parseEther(sendAmount.toFixed(6)),
        gasLimit: 21000,
        maxFeePerGas: feeData.maxFeePerGas,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
        type: 2,
        chainId: await this.provider.getNetwork().then(n => n.chainId),
      });

      const explorerLink = `https://megaexplorer.xyz/tx/${tx.hash}`;
      this.log(`  TX Hash: ${tx.hash}`);
      this.log(`  Explorer: ${explorerLink}`);

      await tx.wait();
      this.log(`  ✅ Confirmed`);

      this.successCount++;
      this.updateTable(address, balance.toFixed(6), sendAmount.toFixed(6), "Success", estGasEth.toFixed(6), `🔗 ${explorerLink}`);
    } catch (err) {
      this.failCount++;
      const bal = await this.getBalance(address).catch(() => 0);
      this.log(`  ❌ Error: ${err.message}`);
      this.updateTable(address, bal.toFixed(6), "0.000000", "Failed", bal.toFixed(6), err.message.slice(0, 30) + "...");
    }
  }

  async run() {
    try {
      await this.connect();
      await this.loadConfig();

      this.log(`\n🔹 Target: ${this.targetAddress}`);
      this.log(`🔹 Wallets: ${this.privateKeys.length}\n`);

      for (let i = 0; i < this.privateKeys.length; i++) {
        await this.processWallet(this.privateKeys[i], i);
        if (i < this.privateKeys.length - 1) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }

      this.log(`\n✅ Consolidation complete!`);
    } catch (err) {
      this.log(`\n❌ Fatal Error: ${err.message}`);
    } finally {
      this.updateStatusBox();
    }
  }
}

new ETHConsolidator().run();
