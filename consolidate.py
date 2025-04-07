import os
from web3 import Web3
from web3.exceptions import TransactionNotFound
from dotenv import load_dotenv

load_dotenv()

class ETHConsolidator:
    def __init__(self):
        # Initialize Web3 connection to MegaETH testnet
        self.w3 = Web3(Web3.HTTPProvider('https://rpc.testnet.megaeth.com'))
        self.chain_id = 42069  # MegaETH testnet chain ID
        
        # Load target address
        with open('target_address.txt', 'r') as f:
            self.target_address = f.read().strip()
        
        # Validate target address
        if not self.w3.is_address(self.target_address):
            raise ValueError("Invalid target address in target_address.txt")
        
        # Load private keys
        with open('private_keys.txt', 'r') as f:
            self.private_keys = [line.strip() for line in f if line.strip()]

    def get_balance(self, address):
        """Get balance in ETH"""
        balance_wei = self.w3.eth.get_balance(address)
        return self.w3.from_wei(balance_wei, 'ether')

    def transfer_eth(self, private_key):
        """Transfer ETH from one wallet to target address"""
        account = self.w3.eth.account.from_key(private_key)
        address = account.address
        
        print(f"\nProcessing wallet: {address}")
        
        # Get balance
        balance = self.get_balance(address)
        print(f"Current balance: {balance} ETH")
        
        if balance <= 0:
            print("Skipping - zero balance")
            return None
        
        # Calculate amount to send (leave 0.001 ETH for gas)
        amount_to_send = max(balance - 0.001, 0)
        if amount_to_send <= 0:
            print("Skipping - insufficient balance after gas reserve")
            return None
            
        print(f"Preparing to send: {amount_to_send} ETH")
        
        try:
            # Get current gas price
            gas_price = self.w3.eth.gas_price
            gas_limit = 21000  # Standard transfer gas limit
            
            # Estimate gas cost
            gas_cost = self.w3.from_wei(gas_price * gas_limit, 'ether')
            print(f"Estimated gas cost: {gas_cost} ETH")
            
            # Build transaction
            nonce = self.w3.eth.get_transaction_count(address)
            
            tx = {
                'nonce': nonce,
                'to': self.target_address,
                'value': self.w3.to_wei(amount_to_send, 'ether'),
                'gas': gas_limit,
                'gasPrice': gas_price,
                'chainId': self.chain_id
            }
            
            # Sign and send transaction
            signed_tx = self.w3.eth.account.sign_transaction(tx, private_key)
            tx_hash = self.w3.eth.send_raw_transaction(signed_tx.rawTransaction)
            
            print(f"Transaction sent: {tx_hash.hex()}")
            
            # Wait for transaction receipt
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash)
            print(f"Transaction confirmed in block: {receipt['blockNumber']}")
            
            return tx_hash.hex()
            
        except Exception as e:
            print(f"Error processing transaction: {str(e)}")
            return None

    def run(self):
        """Process all wallets"""
        print(f"Starting consolidation to target address: {self.target_address}")
        print(f"Found {len(self.private_keys)} wallets to process")
        
        for i, private_key in enumerate(self.private_keys, 1):
            try:
                print(f"\nProcessing wallet {i}/{len(self.private_keys)}")
                self.transfer_eth(private_key)
            except Exception as e:
                print(f"Error processing wallet: {str(e)}")
                continue
        
        print("\nConsolidation complete!")

if __name__ == "__main__":
    consolidator = ETHConsolidator()
    consolidator.run()
