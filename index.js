import { ethers } from "ethers";
import chalk from "chalk";
import ora from "ora";
import figlet from "figlet";
import cliProgress from "cli-progress";
import fs from "fs";

// 🎯 Config
const RPC_URL = 'https://carrot.megaeth.com/rpc';
const TARGET_ADDRESS = '0xf6c206788597D497dBE431898A18daB5bc4dC60A';
const provider = new ethers.JsonRpcProvider(RPC_URL);

// 📂 Load wallets
const wallets = JSON.parse(fs.readFileSync('./wallets.json', 'utf-8'));

// 💡 Stats
let success = 0, failed = 0, skipped = 0;

// 🎬 Fancy banner
console.log(chalk.cyan(figlet.textSync("MEGA ETH", { font: "Slant" })));
console.log(chalk.green.bold("🚀 Starting MEGA ETH Consolidation"));
console.log(`📌 ${chalk.yellow("Chain ID")}: 6342`);
console.log(`🎯 ${chalk.yellow("Target Address")}: ${TARGET_ADDRESS}`);
console.log(`🔑 ${chalk.yellow("Wallets to process")}: ${wallets.length}`);
console.log(`\n✅ Connected to ${RPC_URL}\n`);

// 📊 Progress bar setup
const bar = new cliProgress.SingleBar({
  format: `${chalk.magenta('Progress')} [{bar}] {percentage}% | {value}/{total} wallets`,
  barCompleteChar: '\u2588',
  barIncompleteChar: '\u2591',
  hideCursor: true
}, cliProgress.Presets.shades_classic);

bar.start(wallets.length, 0);

// 🔁 Wallet Processor
async function processWallet(index, walletData) {
  const { privateKey } = walletData;
  const wallet = new ethers.Wallet(privateKey, provider);
  const spinner = ora(`🔍 [${index + 1}] Checking ${wallet.address}`).start();

  try {
    const balance = await provider.getBalance(wallet.address);
    const ethBalance = parseFloat(ethers.formatEther(balance));

    spinner.text = `💰 Balance: ${chalk.yellow(ethBalance.toFixed(5))} ETH`;

    if (ethBalance > 0.002) {
      const valueToSend = ethBalance - 0.001;
      spinner.text = `💸 Sending ${valueToSend.toFixed(5)} ETH...`;

      const tx = await wallet.sendTransaction({
        to: TARGET_ADDRESS,
        value: ethers.parseEther(valueToSend.toString())
      });

      await tx.wait();

      spinner.succeed(`✅ ${wallet.address}\n   💸 Sent: ${chalk.green(valueToSend.toFixed(5))} ETH\n   🔗 Tx Link: ${chalk.blue.underline(`https://megaexplorer.xyz/tx/${tx.hash}`)}\n   🧾 Block: ${chalk.yellow(tx.blockNumber)}`);
      success++;
    } else {
      spinner.warn(`⚠️ ${wallet.address} | Skipped - low balance (${ethBalance.toFixed(5)} ETH)`);
      skipped++;
    }
  } catch (err) {
    spinner.fail(`❌ ${wallet.address} | ${chalk.red(err.message)}`);
    failed++;
  }

  bar.increment();
}

// 🚀 Start processing
async function main() {
  for (let i = 0; i < wallets.length; i++) {
    await processWallet(i, wallets[i]);
  }

  bar.stop();

  console.log(`\n✨ ${chalk.bold("Done!")}`);
  console.log(`${chalk.green("✅ Success")}: ${success}`);
  console.log(`${chalk.red("❌ Failed")}: ${failed}`);
  console.log(`${chalk.yellow("⏩ Skipped")}: ${skipped}\n`);
}

main();
