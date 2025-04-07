const fs = require("fs");
const { ethers } = require("ethers");
const chalk = require("chalk");
const ora = require("ora");
const figlet = require("figlet");

// Load private keys and target address
const privateKeys = fs.readFileSync("private_keys.txt", "utf-8").split("\n").filter(Boolean);
const targetAddress = fs.readFileSync("target_address.txt", "utf-8").trim();

// RPC endpoints
const rpcEndpoints = [
  "https://carrot.megaeth.com/rpc",
  "https://rpc.testnet.megaeth.com",
  "https://testnet.megaeth.io/rpc",
];

const chainId = 6342;
const gasLimit = 21000;
const maxFeePerGas = ethers.parseUnits("0.0025", "gwei");
const maxPriorityFeePerGas = ethers.parseUnits("0.001", "gwei");

let provider;

async function connectProvider() {
  for (const url of rpcEndpoints) {
    try {
      const p = new ethers.JsonRpcProvider(url);
      await p.getBlockNumber(); // test connection
      console.log(chalk.green(`✅ Connected to ${url}`));
      return p;
    } catch {
      console.log(chalk.yellow(`⚠️ Failed to connect to ${url}`));
    }
  }
  throw new Error("❌ Could not connect to any RPC endpoint.");
}

async function processWallet(privateKey, index, total) {
  const spinner = ora(`🔐 Processing wallet [${index}/${total}]`).start();

  try {
    const wallet = new ethers.Wallet(privateKey, provider);
    const balance = await provider.getBalance(wallet.address);
    const ethBalance = Number(ethers.formatEther(balance));

    if (ethBalance <= 0) {
      spinner.warn(chalk.gray(`⏩ ${wallet.address} | Skipped - zero balance`));
      return { status: "skipped" };
    }

    const amountToSend = Math.max(ethBalance - 0.001, 0);
    if (amountToSend <= 0) {
      spinner.warn(chalk.gray(`⏩ ${wallet.address} | Skipped - low balance`));
      return { status: "skipped" };
    }

    const tx = {
      to: targetAddress,
      value: ethers.parseEther(amountToSend.toFixed(6)),
      gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas,
      chainId,
      type: 2,
    };

    const response = await wallet.sendTransaction(tx);
    const receipt = await response.wait();
    const remainingBalance = await provider.getBalance(wallet.address);

    spinner.succeed(chalk.cyanBright(`✅ ${wallet.address}`));
    console.log(chalk.green(`   💸 Sent:        ${amountToSend.toFixed(6)} ETH`));
    console.log(chalk.blue(`   🔗 Tx Link:     https://megaexplorer.xyz/tx/${response.hash}`));
    console.log(chalk.gray(`   🧾 Block:       ${receipt.blockNumber}`));
    console.log(chalk.gray(`   💼 Remaining:   ${Number(ethers.formatEther(remainingBalance)).toFixed(6)} ETH`));
    return { status: "success" };

  } catch (err) {
    spinner.fail(chalk.red(`❌ Error: ${err.message}`));
    return { status: "failed" };
  }
}

(async () => {
  console.log(chalk.magenta(figlet.textSync("MEGA ETH", { horizontalLayout: "fitted" })));
  console.log(chalk.cyanBright(`🚀 Starting MEGA ETH Consolidation`));
  console.log(chalk.gray(`📌 Chain ID: ${chainId}`));
  console.log(chalk.gray(`🎯 Target Address: ${targetAddress}`));
  console.log(chalk.gray(`🔑 Wallets to process: ${privateKeys.length}\n`));

  provider = await connectProvider();

  let success = 0, fail = 0, skipped = 0;

  for (let i = 0; i < privateKeys.length; i++) {
    const result = await processWallet(privateKeys[i], i + 1, privateKeys.length);
    if (result.status === "success") success++;
    else if (result.status === "failed") fail++;
    else skipped++;
    await new Promise(res => setTimeout(res, 1000));
  }

  console.log(chalk.yellow(`\n✨ Done!`));
  console.log(chalk.green(`✅ Success: ${success}`));
  console.log(chalk.red(`❌ Failed: ${fail}`));
  console.log(chalk.gray(`⏩ Skipped: ${skipped}\n`));
})();
