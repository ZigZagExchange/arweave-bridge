# Arweave Bridge

This is a bridge that allows you to use zksync transactions to access permanent storage on Arweave.

It will eventually be extended to other Layer 2s on Ethereum

# Usage

## Top up allocation

Send USDC, USDT, or DAI on zksync to the address:

```
0xcb7aca0cdea76c5bd5946714083c559e34627607
```

Funds sent here will top up your allocation at a rate of 1 MB / dollar. Once the transfer has been committed, check the below endpoint to view your updated allocation. Funds should take no longer than 1-2 min to credit. 

## Get user allocation

```
curl http://localhost:3000/allocation/zksync?address=0x1998CA1E0e9D4a767359464dee60D15daa372cd1

{"remaining_bytes":"100001"}
```


## Uploading a File

```
curl -X POST http://localhost:3000/arweave/upload -H 'Content-Type: multipart/form-data' -F sender=0x1998CA1E0e9D4a767359464dee60D15daa372cd1 -F file=@ETH-USDT.json -F timestamp=$((1000 * $(date +%s)))
```

## Get Server Time

```
curl http://localhost:3000/time

{"time":1640688523}
```
