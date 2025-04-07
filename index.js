// index.js
import fs from 'fs';
import { ethers } from 'ethers';
import ora from 'ora';
import chalk from 'chalk';
import figlet from 'figlet';

// CONFIG
const RPC_URL = 'https://carrot.megaeth.com/rpc';
const EXPLORER_TX = 'https://megaexplorer.xyz/tx/';
const CHAIN_ID = 6342;
const SHARD_SIZE = 50; // Process wallets in chunks

// Read from file
function readLines(path) {
  return fs.readFileSync(path, 'utf-8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

function getShards(wallets, size) {
  const shards = [];
  for (let i = 0; i < wallets.length; i += size) {
    shards.push(wallets.slice(i, i + size));
  }
  return shards;
}

async function sendAll(wallets, target, provider) {
  let success = 0, fail = 0, skipped = 0;

  for (let index = 0; index < wallets.length; index++) {
    const key = wallets[index];
    const spinner = ora(`🔐 Wallet [${index + 1}/${wallets.length}]`).start();

    try {
      const wallet = new ethers.Wallet(key, provider);
      const balance = await provider.getBalance(wallet.address);

      if (balance.eq(0)) {
        spinner.warn(`⏩ ${wallet.address} | Skipped - zero balance`);
        skipped++;
        continue;
      }

      const gasPrice = await provider.getGasPrice();
      const gasLimit = 21000n;
      const fee = gasPrice * gasLimit;

      if (balance <= fee) {
        spinner.warn(`⚠️ ${wallet.address} | Not enough ETH for gas`);
        skipped++;
        continue;
      }

      const tx = await wallet.sendTransaction({
        to: target,
        value: balance - fee,
        gasLimit,
        gasPrice
      });

      const receipt = await tx.wait();
      const link = `${EXPLORER_TX}${receipt.transactionHash}`;
      const block = receipt.blockNumber;

      spinner.succeed(`${chalk.green('✅')} ${wallet.address}
   💸 Sent:        ${ethers.formatEther(balance - fee)} ETH
   🔗 Tx Link:     ${link}
   🧾 Block:       ${block}
   💼 Remaining:   ${ethers.formatEther(await provider.getBalance(wallet.address))} ETH`);

      success++;

    } catch (err) {
      spinner.fail(`❌ ${wallets[index].slice(0, 12)}... | Error: ${err.message}`);
      fail++;
    }
  }

  return { success, fail, skipped };
}

async function consolidateWallets() {
  console.log(chalk.cyan(figlet.textSync('MEGA ETH', { horizontalLayout: 'fitted' })));
  console.log(chalk.yellow('🚀 Starting MEGA ETH Consolidation'));
  console.log(chalk.gray(`📌 Chain ID: ${CHAIN_ID}`));

  const wallets = readLines('private_keys.txt');
  const target = readLines('target_address.txt')[0];

  console.log(`🎯 Target Address: ${chalk.green(target)}`);
  console.log(`🔑 Wallets to process: ${wallets.length}\n`);

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  console.log(chalk.green(`✅ Connected to ${RPC_URL}\n`));

  const shards = getShards(wallets, SHARD_SIZE);
  let totals = { success: 0, fail: 0, skipped: 0 };

  for (let i = 0; i < shards.length; i++) {
    console.log(chalk.blue(`📦 Shard ${i + 1}/${shards.length}`));
    const result = await sendAll(shards[i], target, provider);
    totals.success += result.success;
    totals.fail += result.fail;
    totals.skipped += result.skipped;
  }

  console.log(chalk.bold.green('\n✨ Done!'));
  console.log(`✅ Success: ${totals.success}`);
  console.log(`❌ Failed: ${totals.fail}`);
  console.log(`⏩ Skipped: ${totals.skipped}`);
}

consolidateWallets();
