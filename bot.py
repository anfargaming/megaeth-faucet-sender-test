import os
import time
import csv
import threading
from concurrent.futures import ThreadPoolExecutor
from web3 import Web3
from dotenv import load_dotenv
from colorama import init, Fore, Style
from rich.console import Console
from rich.table import Table
from rich.progress import Progress, SpinnerColumn, BarColumn, TextColumn
from pynput import keyboard

init()
console = Console()
load_dotenv()

class MegaEthSender:
    def __init__(self, ui_callback):
        self.ui_callback = ui_callback
        self.rpc_endpoints = ['https://carrot.megaeth.com/rpc']
        self.chain_id = 6342
        self.max_fee_per_gas = Web3.to_wei(0.0025, 'gwei')
        self.max_priority_fee_per_gas = Web3.to_wei(0.001, 'gwei')
        self.w3 = self._connect_to_provider()
        self.target_address = self._load_target_address()
        self.private_keys = self._load_private_keys()

    def _connect_to_provider(self):
        for endpoint in self.rpc_endpoints:
            try:
                w3 = Web3(Web3.HTTPProvider(endpoint))
                if w3.is_connected():
                    self.ui_callback(f"Connected to {endpoint}", "success")
                    return w3
            except Exception as e:
                self.ui_callback(f"Connection failed to {endpoint}: {str(e)}", "warning")
        raise ConnectionError("Could not connect to any RPC endpoint")

    def _load_target_address(self):
        with open('target_address.txt', 'r') as f:
            address = f.read().strip()
        if not Web3.is_address(address):
            raise ValueError("Invalid target address")
        return address

    def _load_private_keys(self):
        keys = []
        with open('private_keys.txt', 'r') as f:
            for line in f:
                line = line.strip()
                if line:
                    keys.append(line)
        if not keys:
            raise ValueError("No private keys found")
        return keys

    def transfer_eth(self, private_key):
        account = self.w3.eth.account.from_key(private_key)
        address = account.address

        try:
            balance_wei = self.w3.eth.get_balance(address)
            balance_eth = float(Web3.from_wei(balance_wei, 'ether'))

            if balance_eth <= 0:
                self.ui_callback(f"{address[:8]}...{address[-6:]} - Zero balance", "warning")
                return None, 0.0

            gas_cost = float(Web3.from_wei(21000 * self.max_fee_per_gas, 'ether'))
            amount_to_send = max(balance_eth - gas_cost, 0)

            if amount_to_send <= 0:
                self.ui_callback(f"{address[:8]}...{address[-6:]} - Insufficient balance", "warning")
                return None, 0.0

            tx = {
                'nonce': self.w3.eth.get_transaction_count(address),
                'to': self.target_address,
                'value': Web3.to_wei(amount_to_send, 'ether'),
                'gas': 21000,
                'maxFeePerGas': self.max_fee_per_gas,
                'maxPriorityFeePerGas': self.max_priority_fee_per_gas,
                'chainId': self.chain_id,
                'type': '0x2'
            }

            signed_tx = self.w3.eth.account.sign_transaction(tx, private_key)
            tx_hash = self.w3.eth.send_raw_transaction(signed_tx.rawTransaction)
            self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)

            with open('transactions.csv', 'a', newline='') as f:
                writer = csv.writer(f)
                writer.writerow([address, balance_eth, amount_to_send, tx_hash.hex()])

            self.ui_callback(f"{address[:8]}...{address[-6:]} - Sent {amount_to_send:.6f} ETH", "success")
            return tx_hash.hex(), amount_to_send

        except Exception as e:
            with open('errors.log', 'a') as f:
                f.write(f"{address},{str(e)}\n")
            self.ui_callback(f"{address[:8]}...{address[-6:]} - Error: {str(e)}", "error")
            return None, 0.0

class MegaEthSenderUI:
    def __init__(self):
        self.sender = MegaEthSender(self.update_console)
        self.total_wallets = len(self.sender.private_keys)
        self.processed = 0
        self.successful = 0
        self.failed = 0
        self.eth_sent = 0.0
        self.logs = []
        self.quit_flag = False
        self.listener = keyboard.Listener(on_press=self.on_key_press)
        self.listener.start()

    def on_key_press(self, key):
        try:
            if key.char == 'q':
                self.quit_flag = True
                self.update_console("User pressed Q to quit.", "warning")
            elif key.char == 'r':
                self.update_console("Refreshing display...", "info")
                self.render_ui()
        except AttributeError:
            pass

    def update_console(self, message, msg_type="info"):
        timestamp = time.strftime("%H:%M:%S")
        self.logs.append(f"{timestamp} | [{msg_type.upper()}] {message}")
        self.render_ui()

    def render_ui(self):
        os.system('cls' if os.name == 'nt' else 'clear')

        header = f"""
{Fore.CYAN}███╗   ███╗███████╗ ██████╗  █████╗     ███████╗████████╗██╗  ██╗{Style.RESET_ALL}
{Fore.CYAN}████╗ ████║██╔════╝██╔════╝ ██╔══██╗    ██╔════╝╚══██╔══╝██║  ██║{Style.RESET_ALL}
{Fore.CYAN}██╔████╔██║█████╗  ██║  ███╗███████║    █████╗     ██║   ███████║{Style.RESET_ALL}
{Fore.CYAN}██║╚██╔╝██║██╔══╝  ██║   ██║██╔══██║    ██╔══╝     ██║   ██╔══██║{Style.RESET_ALL}
{Fore.CYAN}██║ ╚═╝ ██║███████╗╚██████╔╝██║  ██║    ███████╗   ██║   ██║  ██║{Style.RESET_ALL}
{Fore.CYAN}╚═╝     ╚═╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝    ╚══════╝   ╚═╝   ╚═╝  ╚═╝{Style.RESET_ALL}
        """
        console.print(header)

        wallet_table = Table(title="Wallet Metrics", style="bold cyan")
        wallet_table.add_column("Target")
        wallet_table.add_column("Network")
        wallet_table.add_column("Wallets")
        wallet_table.add_column("Success")
        wallet_table.add_column("Failed")
        wallet_table.add_column("ETH Sent")

        wallet_table.add_row(
            self.sender.target_address[:10] + "...",
            "PRIOR Testnet",
            str(self.total_wallets),
            str(self.successful),
            str(self.failed),
            f"{self.eth_sent:.6f}"
        )
        console.print(wallet_table)

        log_table = Table(title="Logs", style="bold yellow")
        log_table.add_column("Time & Event")
        for log in self.logs[-10:]:
            log_table.add_row(log)
        console.print(log_table)

        controls = f"""
[Controls] Press:
  r - Refresh UI
  q - Quit App
        """
        console.print(controls, style="dim")

    def run(self):
        self.update_console("=== Starting MEGA ETH Sender ===", "info")
        with open('transactions.csv', 'w', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(['Address', 'Balance', 'Amount Sent', 'TxHash'])

        with Progress(
            SpinnerColumn(),
            TextColumn("{task.description}"),
            BarColumn(),
            TextColumn("{task.completed}/{task.total}"),
            transient=True,
        ) as progress:
            task = progress.add_task("Processing wallets...", total=self.total_wallets)

            with ThreadPoolExecutor(max_workers=5) as executor:
                future_to_key = {executor.submit(self.sender.transfer_eth, pk): pk for pk in self.sender.private_keys}
                for future in future_to_key:
                    if self.quit_flag:
                        break
                    tx_result, sent_amount = future.result()
                    self.eth_sent += sent_amount
                    if tx_result:
                        self.successful += 1
                    else:
                        self.failed += 1
                    self.processed += 1
                    progress.advance(task)

        self.update_console("\n=== Transaction Summary ===", "info")
        self.update_console(f"Total Wallets: {self.total_wallets}", "info")
        self.update_console(f"Successful: {self.successful}", "success")
        self.update_console(f"Failed: {self.failed}", "error")
        self.update_console(f"Total ETH Sent: {self.eth_sent:.6f}", "success")

if __name__ == "__main__":
    app = MegaEthSenderUI()
    app.run()
