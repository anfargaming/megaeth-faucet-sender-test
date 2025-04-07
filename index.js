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

    this.logBox = this.grid.set(0, 0, 12, 8, contrib.log, {
      label: " Transaction Logs ",
      border: { type: "line", fg: "cyan" },
      scrollbar: { style: { bg: "blue" } },
    });

    this.walletTable = this.grid.set(0, 8, 6, 4, contrib.table, {
      label: " Wallet Status ",
      columnWidth: [20, 12, 12, 12, 12, 34],
      columnSpacing: 2,
      border: { type: "line", fg: "cyan" },
    });

    this.statusBox = this.grid.set(6, 8, 6, 4, blessed.box, {
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
      `{bold}Final Status:{/bold} ${total === this.privateKeys?.length ? "Completed" : "Processing..."}` +
      `\n\n{bold}Press 'q' or Ctrl+C to exit{/bold}`
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
    return parseFloat(ethers.formatEther(balance));
  }

  async processWallet(privateKey, index) {
    const wallet = new ethers.Wallet(privateKey, this.provider);
    const address = wallet.address;

    this.log(`\n[${index + 1}/${this.privateKeys.length}] Processing ${address}`);

    try {
      const balance = await this.getBalance(address);
      this.log(`  Current Balance: ${balance.toFixed(6)} ETH`);

      const feeData = await this.provider.getFeeData();
      const gasLimit = 21000;
      const gasCost = (feeData.maxFeePerGas || ethers.parseUnits("1", "gwei")) * gasLimit;

      const balanceInWei = ethers.parseEther(balance.toFixed(6));
      if (balanceInWei <= gasCost) {
        this.log(`  Skipping - Not enough for gas`);
        this.skippedCount++;
        this.updateTable(address, balance.toFixed(6), "0.000000", "Skipped", balance.toFixed(6), "Gas too low");
        return;
      }

      const sendable = parseFloat(ethers.formatEther(balanceInWei - gasCost));
      this.log(`  Sending: ${sendable.toFixed(6)} ETH`);

      const tx = await wallet.sendTransaction({
        to: this.targetAddress,
        value: ethers.parseEther(sendable.toFixed(6)),
        chainId: this.CHAIN_ID,
        type: 2,
        gasLimit,
        maxFeePerGas: feeData.maxFeePerGas,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
      });

      this.log(`  TX Hash: ${tx.hash}`);
      const explorer = `https://megaexplorer.xyz/tx/${tx.hash}`;
      this.log(`  Explorer: ${explorer}`);

      await tx.wait();
      this.log(`  ✅ Transaction confirmed`);

      this.successCount++;
      this.updateTable(
        address,
        balance.toFixed(6),
        sendable.toFixed(6),
        "Success",
        "0.000000",
        `🔗 ${explorer}`
      );
    } catch (err) {
      this.failCount++;
      const bal = await this.getBalance(address).catch(() => 0);
      this.log(`  ❌ Error: ${err.message}`);
      this.updateTable(
        address,
        bal.toFixed(6),
        "0.000000",
        "Failed",
        bal.toFixed(6),
        err.message.split("\n")[0].slice(0, 30) + "..."
      );
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
