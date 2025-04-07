import { ethers } from "ethers";
import fs from "fs";
import dotenv from "dotenv";
import blessed from "blessed";
import contrib from "blessed-contrib";

dotenv.config();

const RPC_ENDPOINTS = [
  "https://carrot.megaeth.com/rpc",
  "https://rpc.testnet.megaeth.com",
  "https://testnet.megaeth.io/rpc",
];

let provider;
for (const rpc of RPC_ENDPOINTS) {
  try {
    provider = new ethers.JsonRpcProvider(rpc);
    await provider.getBlockNumber();
    console.log(`Connected to ${rpc}`);
    break;
  } catch {
    console.log(`Failed to connect to ${rpc}`);
  }
}

if (!provider) throw new Error("Unable to connect to any RPC");

const targetAddress = fs.readFileSync("target_address.txt", "utf-8").trim();
const privateKeys = fs.readFileSync("private_keys.txt", "utf-8")
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

if (!ethers.isAddress(targetAddress)) throw new Error("Invalid target address");

const chainId = 6342;
const maxFeePerGas = ethers.parseUnits("0.0025", "gwei");
const maxPriorityFeePerGas = ethers.parseUnits("0.001", "gwei");

// Terminal UI
const screen = blessed.screen();
const grid = new contrib.grid({ rows: 12, cols: 12, screen });

const logBox = grid.set(0, 0, 6, 6, contrib.log, {
  label: "Real-time Logs",
  fg: "green",
  selectedFg: "green"
});

const summaryBox = grid.set(0, 6, 6, 6, blessed.box, {
  label: "Summary",
  tags: true,
  style: { fg: "white", border: { fg: "cyan" } },
  content: "Loading..."
});

const walletTable = grid.set(6, 0, 4, 12, contrib.table, {
  keys: true,
  fg: "white",
  label: "Wallet Status",
  columnWidth: [42, 12, 10, 60]
});

const lineChart = grid.set(10, 0, 2, 12, contrib.line, {
  style: {
    line: "yellow",
    text: "green",
    baseline: "black"
  },
  label: "Transaction Count Over Time",
  showLegend: true,
  legend: { width: 15 }
});

const exitInfo = grid.set(11, 0, 1, 12, blessed.box, {
  content: "Press 'q' or Ctrl+C to exit.",
  style: { fg: 'cyan' }
});

screen.key(['q', 'C-c'], function () {
  return process.exit(0);
});

let success = 0, failed = 0;
const tableData = [];
const txTrend = [];

async function getBalance(address) {
  const balance = await provider.getBalance(address);
  return Number(ethers.formatEther(balance));
}

async function sendETH(privateKey, index) {
  const wallet = new ethers.Wallet(privateKey, provider);
  const address = wallet.address;

  logBox.log(`\n[${index + 1}/${privateKeys.length}] Processing ${address}`);

  try {
    const balance = await getBalance(address);
    logBox.log(`  Balance: ${balance.toFixed(6)} ETH`);

    if (balance <= 0.001) {
      logBox.log("  Skipping - insufficient balance");
      failed++;
      tableData.push([address, "0", "Failed", "Insufficient"]);
    } else {
      const amount = balance - 0.001;
      const nonce = await provider.getTransactionCount(address);

      const tx = await wallet.sendTransaction({
        to: targetAddress,
        value: ethers.parseEther(amount.toFixed(6)),
        nonce,
        gasLimit: 21000,
        maxFeePerGas,
        maxPriorityFeePerGas,
        chainId,
        type: 2
      });

      const explorerUrl = `https://explorer.megaeth.com/tx/${tx.hash}`;
      logBox.log(`  Sending: ${amount.toFixed(6)} ETH`);
      logBox.log(`  TX Hash: ${tx.hash}`);
      logBox.log(`  Explorer: ${explorerUrl}`);

      tableData.push([address, amount.toFixed(6), "Success", explorerUrl]);
      success++;
    }
  } catch (err) {
    logBox.log(`  Error: ${err.message}`);
    failed++;
    tableData.push([address, "0", "Failed", err.message.slice(0, 40)]);
  }

  txTrend.push(success + failed);
  lineChart.setData([{ title: "TX Count", x: txTrend.map((_, i) => `${i + 1}`), y: txTrend }]);

  walletTable.setData({
    headers: ["Address", "Amount", "Status", "Info / Link"],
    data: tableData
  });

  summaryBox.setContent(`{green-fg}✅ Success:{/green-fg} ${success}\n{red-fg}❌ Failed:{/red-fg} ${failed}\n{cyan-fg}📦 Completed:{/cyan-fg} ${success + failed}`);
  screen.render();
}

async function run() {
  logBox.log("Starting MEGA ETH Consolidator...");
  for (let i = 0; i < privateKeys.length; i++) {
    await sendETH(privateKeys[i], i);
  }
  logBox.log("\nAll wallets processed.");
  logBox.log(`Total Success: ${success}`);
  logBox.log(`Total Failed: ${failed}`);
  logBox.log("Final Status: Completed");

  exitInfo.setContent("Press 'q' or Ctrl+C to exit.");
  screen.render();
}

run();
