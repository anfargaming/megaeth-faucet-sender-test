import fs from 'fs';
import * as ethers from 'ethers';
import figlet from 'figlet';
import chalk from 'chalk';
import ora from 'ora';
import blessed from 'blessed';
import contrib from 'blessed-contrib';

const targetAddress = fs.readFileSync('target_address.txt', 'utf8').trim();
const privateKeys = fs.readFileSync('private_keys.txt', 'utf8').trim().split('\n');

const RPCs = [
  "https://rpc.megaeth.tech", 
  "https://megaeth.nodeguardians.io"
];

const provider = new ethers.JsonRpcProvider(RPCs[Math.floor(Math.random() * RPCs.length)]);

const gasLimit = 21000;
const minAmount = ethers.parseEther("0.0003");

const failedWallets = [];

const screen = blessed.screen();
const grid = new contrib.grid({ rows: 12, cols: 12, screen: screen });

const logBox = grid.set(0, 0, 6, 9, blessed.log, {
  label: 'Transaction Logs',
  border: 'line',
  style: { border: { fg: 'cyan' } },
  scrollable: true,
  scrollbar: { ch: ' ', inverse: true },
});

const walletTable = grid.set(6, 0, 6, 9, contrib.table, {
  keys: true,
  fg: 'green',
  label: 'Wallet Status',
  columnWidth: [20, 12, 12, 18, 50],
  columnSpacing: 2,
  interactive: false,
});

const finalBox = grid.set(0, 9, 12, 3, blessed.box, {
  label: 'Final Status',
  border: 'line',
  style: { border: { fg: 'green' } },
  content: '',
});

screen.key(['escape', 'q', 'C-c'], () => process.exit(0));
screen.render();

const tableData = [];

const main = async () => {
  let success = 0, failed = 0, skipped = 0;

  for (let i = 0; i < privateKeys.length; i++) {
    const pk = privateKeys[i].trim();
    const wallet = new ethers.Wallet(pk, provider);

    let balance;
    try {
      balance = await provider.getBalance(wallet.address);
    } catch (err) {
      logBox.log(`❌ Error fetching balance for ${wallet.address}`);
      failed++;
      failedWallets.push(wallet.address);
      continue;
    }

    const ethBalance = parseFloat(ethers.formatEther(balance));
    const shortAddress = wallet.address.slice(0, 6) + "..." + wallet.address.slice(-4);

    if (balance < minAmount) {
      logBox.log(`Current Balance: ${chalk.green(ethBalance)} ETH`);
      logBox.log(chalk.yellow(`⚠️ Skipped: Not enough ETH to send.`));
      skipped++;
      tableData.push([shortAddress, ethBalance.toFixed(6), "0.000000", `S↓${ethBalance.toFixed(6)}`, "Low balance"]);
      updateUI();
      continue;
    }

    let feeData;
    try {
      feeData = await provider.getFeeData();
    } catch (err) {
      logBox.log(`❌ Failed to get gas fee data`);
      failed++;
      failedWallets.push(wallet.address);
      continue;
    }

    const estimatedFee = feeData.maxFeePerGas * BigInt(gasLimit);
    const sendable = balance - estimatedFee;
    if (sendable <= 0) {
      logBox.log(`❌ Not enough for gas`);
      skipped++;
      tableData.push([shortAddress, ethBalance.toFixed(6), "0.000000", `S↓${ethBalance.toFixed(6)}`, "Low balance"]);
      updateUI();
      continue;
    }

    try {
      const tx = await wallet.sendTransaction({
        to: targetAddress,
        value: sendable,
        maxFeePerGas: feeData.maxFeePerGas,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
        gasLimit
      });

      const spinner = ora(`Sending: ${ethers.formatEther(sendable)} ETH`).start();
      const receipt = await tx.wait();

      spinner.succeed(`TX Hash: ${tx.hash}`);
      logBox.log(`Explorer: https://megaexplorer.xyz/tx/${tx.hash}`);
      logBox.log(`Transaction confirmed`);

      tableData.push([
        shortAddress,
        ethBalance.toFixed(6),
        ethers.formatEther(sendable),
        `Su${ethers.formatEther(balance - sendable)}`,
        chalk.green("? ") + `https://megaexplorer.xyz/tx/${tx.hash}`
      ]);

      success++;
    } catch (err) {
      logBox.log(`❌ Error: ${err.message.split('\n')[0]}`);
      failed++;
      failedWallets.push(wallet.address);
      tableData.push([shortAddress, ethBalance.toFixed(6), "0.000000", `Fail${ethBalance.toFixed(6)}`, chalk.red("TX Failed")]);
    }

    updateUI();
  }

  fs.writeFileSync("failed_wallets.txt", failedWallets.join('\n'));

  finalBox.setContent(
    `Total ${chalk.green('Success')}: ${success}\n` +
    `Total ${chalk.red('Failed')}: ${failed}\n` +
    `Total Skipped: ${skipped}\n` +
    `Final Status: ${chalk.white('Completed')}`
  );
  screen.render();
};

function updateUI() {
  walletTable.setData({
    headers: ['Address', 'Current', 'Transfer', 'Status', 'Info'],
    data: tableData
  });
  screen.render();
}

console.clear();
console.log(chalk.cyan(figlet.textSync('ETH Consolidator')));
main();
