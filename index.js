// index.js (ES Module style)

import { ethers } from "ethers";
import fs from "fs";
import dotenv from "dotenv";
import chalk from "chalk";
import blessed from "blessed";
import contrib from "blessed-contrib";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const rpcEndpoints = [
  "https://carrot.megaeth.com/rpc",
  "https://rpc.testnet.megaeth.com",
  "https://testnet.megaeth.io/rpc",
];

let provider;

async function connectProvider() {
  for (const url of rpcEndpoints) {
    try {
      const tempProvider = new ethers.JsonRpcProvider(url);
      await tempProvider.getBlockNumber();
      console.log(chalk.green(`Connected to ${url}`));
      provider = tempProvider;
      return;
    } catch (err) {
      console.log(chalk.red(`Failed to connect to ${url}`));
    }
  }
  throw new Error("Could not connect to any RPC endpoint");
}

const targetAddress = fs.readFileSync("target_address.txt", "utf8").trim();
const privateKeys = fs
  .readFileSync("private_keys.txt", "utf8")
  .split("\n")
  .map((k) => k.trim())
  .filter(Boolean);

const chainId = 6342;
const maxFeePerGas = ethers.parseUnits("0.0025", "gwei");
const maxPriorityFeePerGas = ethers.parseUnits("0.001", "gwei");

// Terminal Dashboard Setup
const screen = blessed.screen();
const grid = new contrib.grid({ rows: 12, cols: 12, screen });
const logBox = grid.set(0, 0, 6, 9, contrib.log, { label: "💬 Real-time Logs" });
const donut = grid.set(0, 9, 6, 3, contrib.donut, {
  label: "📊 Success/Fail Chart",
  radius: 16,
  arcWidth: 4,
  yPadding: 2,
  data: [],
});
const table = grid.set(6, 0, 6, 12, contrib.table, {
  label: "📋 Wallet Status",
  columnWidth: [42, 12, 10, 80],
  keys: true,
  interactive: false,
  columnSpacing: 2,
  columnAlign: ["left", "center", "center", "left"],
});

let success = 0,
  fail = 0;

function updateDonut() {
  donut.setData([
    { percent: (success / privateKeys.length) * 100 || 0, label: "Success", color: "green" },
    { percent: (fail / privateKeys.length) * 100 || 0, label: "Fail", color: "red" },
  ]);
  screen.render();
}

async function getBalance(address) {
  try {
    const balance = await provider.getBalance(address);
    return parseFloat(ethers.formatEther(balance));
  } catch (err) {
    throw new Error("Error getting balance");
  }
}

async function sendETH(privateKey, index) {
  const wallet = new ethers.Wallet(privateKey, provider);
  const address = wallet.address;
  logBox.log(`🔍 Processing ${address}`);

  try {
    const balance = await getBalance(address);
    if (balance <= 0.001) {
      logBox.log(chalk.yellow(`💸 Skipped - Low Balance: ${balance.toFixed(6)} ETH`));
      return false;
    }

    const amountToSend = balance - 0.001;
    const tx = await wallet.sendTransaction({
      to: targetAddress,
      value: ethers.parseEther(amountToSend.toFixed(18)),
      maxFeePerGas,
      maxPriorityFeePerGas,
      gasLimit: 21000,
    });

    logBox.log(chalk.green(`🚀 Sent ${amountToSend.toFixed(6)} ETH | TX: ${tx.hash}`));
    const receipt = await tx.wait();
    logBox.log(chalk.cyan(`✅ Confirmed in block ${receipt.blockNumber}`));

    table.rows.push([
      address,
      balance.toFixed(4),
      "✅",
      `https://megaexplorer.xyz/tx/${tx.hash}`,
    ]);
    success++;
    return true;
  } catch (err) {
    logBox.log(chalk.red(`❌ Error: ${err.message}`));
    table.rows.push([address, "-", "❌", err.message]);
    fail++;
    return false;
  } finally {
    updateDonut();
    table.setData({
      headers: ["Address", "Balance", "Status", "Details"],
      data: table.rows,
    });
    screen.render();
  }
}

async function run() {
  await connectProvider();
  logBox.log(`📡 Consolidating ${privateKeys.length} wallets to ${targetAddress}`);
  screen.render();

  for (let i = 0; i < privateKeys.length; i++) {
    await sendETH(privateKeys[i], i);
    await new Promise((r) => setTimeout(r, 1000));
  }

  logBox.log(chalk.bold.green("🎉 All wallets processed!"));
  screen.render();
}

run();

screen.key(["escape", "q", "C-c"], () => process.exit(0));
