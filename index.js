const { ethers } = require("ethers");
const fs = require("fs");
const dotenv = require("dotenv");
const chalk = require("chalk");
const blessed = require("blessed");
const contrib = require("blessed-contrib");

dotenv.config();

// RPC Endpoints
const rpcEndpoints = [
  "https://carrot.megaeth.com/rpc",
  "https://rpc.testnet.megaeth.com",
  "https://testnet.megaeth.io/rpc"
];

let provider;
async function connectProvider() {
  for (const url of rpcEndpoints) {
    try {
      const p = new ethers.JsonRpcProvider(url);
      await p.getBlockNumber(); // Check connection
      console.log(chalk.green(`Connected to ${url}`));
      return p;
    } catch (err) {
      console.log(chalk.red(`Failed to connect: ${url}`));
    }
  }
  throw new Error("Unable to connect to any RPC");
}

// Global Variables
const CHAIN_ID = 6342;
const maxFeePerGas = ethers.parseUnits("0.0025", "gwei");
const maxPriorityFeePerGas = ethers.parseUnits("0.001", "gwei");

// Load files
const privateKeys = fs.readFileSync("private_keys.txt", "utf-8").split("\n").filter(Boolean);
const targetAddress = fs.readFileSync("target_address.txt", "utf-8").trim();
if (!ethers.isAddress(targetAddress)) {
  throw new Error("Invalid target address in target_address.txt");
}

// UI Setup
const screen = blessed.screen();
const grid = new contrib.grid({ rows: 12, cols: 12, screen });

const logBox = grid.set(0, 0, 10, 12, contrib.log, {
  label: "Mega ETH Sender Log",
  fg: "green",
  selectedFg: "white"
});

const donut = grid.set(10, 0, 2, 4, contrib.donut, {
  label: "Status",
  radius: 10,
  arcWidth: 4,
  yPadding: 2,
  data: []
});

const table = grid.set(10, 4, 2, 8, contrib.table, {
  keys: false,
  columnWidth: [40, 20]
});

screen.key(["escape", "q", "C-c"], () => process.exit(0));
screen.render();

let success = 0;
let failed = 0;
const results = [];

async function getBalance(addr) {
  try {
    const balance = await provider.getBalance(addr);
    return Number(ethers.formatEther(balance));
  } catch {
    provider = await connectProvider();
    return 0;
  }
}

async function sendETH(privateKey, index) {
  const wallet = new ethers.Wallet(privateKey, provider);
  const sender = wallet.address;

  logBox.log(`\n[${index + 1}/${privateKeys.length}] ${chalk.cyan(sender)}`);

  try {
    const balance = await getBalance(sender);
    logBox.log(`Balance: ${balance} ETH`);
    if (balance <= 0.001) {
      logBox.log(chalk.yellow("Skipped: Low balance"));
      return false;
    }

    const amount = Math.max(balance - 0.001, 0);
    const tx = {
      to: targetAddress,
      value: ethers.parseEther(amount.toFixed(6).toString()),
      maxFeePerGas,
      maxPriorityFeePerGas,
      gasLimit: 21000,
      chainId: CHAIN_ID,
      type: 2
    };

    const sentTx = await wallet.sendTransaction(tx);
    logBox.log(`${chalk.green("Tx Sent:")} ${sentTx.hash}`);
    logBox.log(`Explorer: https://megaexplorer.xyz/tx/${sentTx.hash}`);

    const receipt = await sentTx.wait();
    logBox.log(chalk.green(`Confirmed in Block: ${receipt.blockNumber}`));

    success++;
    results.push([sender, chalk.green("Success")]);
    return true;
  } catch (err) {
    logBox.log(chalk.red("Error: ") + err.message);
    failed++;
    results.push([sender, chalk.red("Failed")]);
    return false;
  }
}

async function runConsolidator() {
  provider = await connectProvider();

  for (let i = 0; i < privateKeys.length; i++) {
    await sendETH(privateKeys[i], i);
    updateUI();
    await new Promise((res) => setTimeout(res, 1000));
  }

  logBox.log("\n" + chalk.bold("✅ Consolidation Complete!"));
  logBox.log(chalk.green(`Successful: ${success}`));
  logBox.log(chalk.red(`Failed: ${failed}`));
}

function updateUI() {
  donut.setData([
    {
      percent: Math.round((success / privateKeys.length) * 100),
      label: "Success",
      color: "green"
    },
    {
      percent: Math.round((failed / privateKeys.length) * 100),
      label: "Failed",
      color: "red"
    }
  ]);

  table.setData({
    headers: ["Wallet Address", "Status"],
    data: results
  });

  screen.render();
}

runConsolidator();
