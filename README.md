# ETH Faucet Consolidator

A simple tool to consolidate testnet ETH from multiple wallets to a single address.

## Setup

1. Install requirements:
```bash
git clone https://github.com/anfargaming/megaeth-faucet-sender
cd megaeth-faucet-sender
```
```bash
pip install -r requirements.txt
```
```bash
private_keys.txt
```
```bash
python bot.py
```


### Key Improvements Over Original:

1. **Simplified Workflow**:
   - Only does consolidation (no faucet claiming or captcha solving)
   - Uses simple text files for input

2. **Better Error Handling**:
   - Gracefully continues if one wallet fails
   - Better transaction monitoring

3. **More Transparent**:
   - Shows exact amounts being sent
   - Displays gas costs
   - Shows transaction confirmations

4. **Safer**:
   - Clearly shows what will be sent before sending
   - Leaves reserve for gas

To use this, just:
1. Put your private keys in `private_keys.txt`
2. Put your target address in `target_address.txt`
3. Run `python consolidate.py`

The script will automatically:
- Check each wallet's balance
- Calculate how much can be sent (leaving 0.001 ETH)
- Send the ETH to your main wallet
- Show transaction confirmations
