import customtkinter as ctk
import tkinter as tk
from tkinter import scrolledtext
from PIL import Image, ImageTk
import time
import threading
import os
from dotenv import load_dotenv
from web3 import Web3
import csv
from concurrent.futures import ThreadPoolExecutor

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

        self.eth_sent = 0.0

    def _connect_to_provider(self):
        for endpoint in self.rpc_endpoints:
            try:
                w3 = Web3(Web3.HTTPProvider(endpoint))
                if w3.is_connected():
                    self.ui_callback(f"✓ Connected to {endpoint}", "success")
                    return w3
            except Exception as e:
                self.ui_callback(f"Connection failed: {str(e)}", "error")
        raise Exception("No working RPC endpoint found")

    def _load_target_address(self):
        with open('target_address.txt') as f:
            addr = f.read().strip()
            if not Web3.is_address(addr):
                raise ValueError("Invalid address")
            return addr

    def _load_private_keys(self):
        with open('private_keys.txt') as f:
            return [line.strip() for line in f if line.strip()]

    def transfer_eth(self, private_key):
        account = self.w3.eth.account.from_key(private_key)
        addr = account.address
        try:
            balance = self.w3.eth.get_balance(addr)
            balance_eth = float(Web3.from_wei(balance, 'ether'))
            if balance_eth <= 0:
                self.ui_callback(f"[!] {addr[:6]}...{addr[-6:]} - Zero balance", "warning")
                return None

            gas_cost = float(Web3.from_wei(21000 * self.max_fee_per_gas, 'ether'))
            send_amt = max(balance_eth - gas_cost, 0)
            if send_amt <= 0:
                self.ui_callback(f"[✗] {addr[:6]}...{addr[-6:]} - Insufficient funds", "error")
                return None

            tx = {
                'nonce': self.w3.eth.get_transaction_count(addr),
                'to': self.target_address,
                'value': Web3.to_wei(send_amt, 'ether'),
                'gas': 21000,
                'maxFeePerGas': self.max_fee_per_gas,
                'maxPriorityFeePerGas': self.max_priority_fee_per_gas,
                'chainId': self.chain_id,
                'type': '0x2'
            }
            signed = self.w3.eth.account.sign_transaction(tx, private_key)
            tx_hash = self.w3.eth.send_raw_transaction(signed.rawTransaction)
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash)
            self.eth_sent += send_amt

            with open('transactions.csv', 'a') as f:
                csv.writer(f).writerow([addr, balance_eth, send_amt, tx_hash.hex()])

            self.ui_callback(f"[✓] {addr[:6]}...{addr[-6:]} - Sent {send_amt:.6f} ETH", "success")
            return tx_hash.hex()
        except Exception as e:
            with open('errors.log', 'a') as f:
                f.write(f"{addr},{e}\n")
            self.ui_callback(f"[✗] {addr[:6]}...{addr[-6:]} - Error: {str(e)}", "error")
            return None

    def run(self):
        start = time.time()
        with open('transactions.csv', 'w') as f:
            csv.writer(f).writerow(['Address', 'Balance', 'Sent', 'TxHash'])
        with ThreadPoolExecutor(max_workers=5) as exec:
            results = list(exec.map(self.transfer_eth, self.private_keys))

        self.ui_callback("\n=== Transaction Summary ===", "info")
        self.ui_callback(f"Total Wallets: {len(self.private_keys)}", "info")
        self.ui_callback(f"Successful: {sum(1 for r in results if r)}", "success")
        self.ui_callback(f"Failed: {len(self.private_keys) - sum(1 for r in results if r)}", "error")
        self.ui_callback(f"ETH Sent: {self.eth_sent:.6f}", "info")
        self.ui_callback(f"Time: {time.time() - start:.2f} sec", "info")

class MegaEthApp(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title("💸 Mega ETH Sender Dashboard")
        self.geometry("920x720")
        ctk.set_appearance_mode("dark")
        ctk.set_default_color_theme("green")

        self.sender = MegaEthSender(self.log)

        self.main_frame = ctk.CTkFrame(self)
        self.main_frame.pack(padx=20, pady=20, fill="both", expand=True)

        self.title_lbl = ctk.CTkLabel(self.main_frame, text="💸 Mega ETH Sender Pro", font=("Helvetica", 28, "bold"))
        self.title_lbl.pack(pady=(10, 20))

        self.start_btn = ctk.CTkButton(self.main_frame, text="🚀 Start Sending", command=self.start_sending, font=("Helvetica", 18))
        self.start_btn.pack(pady=(10, 10))

        self.console = ctk.CTkTextbox(self.main_frame, height=400)
        self.console.pack(padx=10, pady=10, fill="both", expand=True)

        self.footer = ctk.CTkLabel(self.main_frame, text="© 2025 MegaETH Team | All Rights Reserved", font=("Arial", 10))
        self.footer.pack(pady=5)

    def log(self, message, level="info"):
        prefix = {
            "success": "[✓]",
            "error": "[✗]",
            "warning": "[!]",
            "info": "[i]"
        }.get(level, "[i]")
        self.console.insert("end", f"{prefix} {message}\n")
        self.console.see("end")

    def start_sending(self):
        self.start_btn.configure(state="disabled")
        threading.Thread(target=self.run_sender, daemon=True).start()

    def run_sender(self):
        try:
            self.log("\n=== MEGA ETH Sender Pro Running ===", "info")
            self.sender.run()
        except Exception as e:
            self.log(f"Fatal Error: {str(e)}", "error")
        finally:
            self.start_btn.configure(state="normal")

if __name__ == "__main__":
    app = MegaEthApp()
    app.mainloop()
