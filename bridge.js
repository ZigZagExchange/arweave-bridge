import * as zksync from "zksync";
import ethers from 'ethers';
import dotenv from 'dotenv';
import * as Redis from 'redis';

dotenv.config();

// Connect to Redis
const redis_url = process.env.REDIS_URL;
const redis_use_tls = redis_url.includes("rediss");
const redis = Redis.createClient({ 
    url: redis_url,
    socket: {
        tls: redis_use_tls,
        rejectUnauthorized: false
    },
});
redis.on('error', (err) => console.log('Redis Client Error', err));
await redis.connect();

// Update last processed timestamp if necessary
const lastProcessedTimestamp = await redis.get("zksync:bridge:lastProcessedTimestamp");
const lastProcessedDate = new Date(lastProcessedTimestamp); 
const now = new Date();
const thirty_sec_ms = 30*1000;
// Nothing processed yet? Set the last process date to now
// NO OLD TXS processed
if (!lastProcessedDate) {
    await redis.set("zksync:bridge:lastProcessedTimestamp", now.toISOString());
}
// Last processed less than 30s ago?
// Set it to now. Better safe than sorry if you've been down for more than a restart.
// You can manually process anything that fell through. 
if (lastProcessedDate.getTime() < now.getTime() - thirty_sec_ms) {
    await redis.set("zksync:bridge:lastProcessedTimestamp", now.toISOString());
}

// Connect to ETH + Zksync
let syncProvider;
const ethersProvider = new ethers.providers.InfuraProvider(
    process.env.ETH_NETWORK,
    process.env.INFURA_PROJECT_ID,
);
try {
    syncProvider = await zksync.getDefaultRestProvider(process.env.ETH_NETWORK);
} catch (e) {
    console.log(e);
    throw new Error("Could not connect to zksync API");
}

// Load supported tokens
const SUPPORTED_TOKEN_IDS = process.env.SUPPORTED_TOKEN_IDS.split(',').map(v => parseInt(v)).filter(v => !isNaN(v));
const TOKEN_DETAILS = {};
for (let i in SUPPORTED_TOKEN_IDS) {
    const id = SUPPORTED_TOKEN_IDS[i];
    const details = await syncProvider.tokenInfo(id);
    TOKEN_DETAILS[id] = details;
}


processNewWithdraws()

async function processNewWithdraws() {
    const account_txs = await syncProvider.accountTxs(process.env.ZKSYNC_BRIDGE_ADDRESS, {
        from: 'latest', 
        limit: 5, 
        direction: 'older'
    });
    // Reverse the list and loop so that older transactions get processed first
    const reversed_txns = account_txs.list.reverse();
    for (let i in reversed_txns) {
        const tx = reversed_txns[i];
        const txType = tx.op.type;
        const sender = tx.op.from;
        const receiver = tx.op.to;
        const tokenId = tx.op.token;
        const amount = tx.op.amount;
        const txStatus = tx.status;
        const lastProcessedTimestamp = await redis.get("zksync:bridge:lastProcessedTimestamp");
        const lastProcessedDate = new Date(lastProcessedTimestamp); 
        const now = new Date();
        const txhash = tx.txHash;
        const timestamp = new Date(tx.createdAt);
        const isProcessed = await redis.get(`zksync:bridge:${txhash}:processed`);
        
        // Already processed or some other weird value is set? Continue
        if (isProcessed !== null) {
            continue;
        }
        
        // Tx type is not Transfer ? Mark as processed and update last process time
        if (txType !== "Transfer") {
            console.log("Unsupported tx type");
            await redis.set(`zksync:bridge:${txhash}:processed`, 1);
            await redis.set("zksync:bridge:lastProcessedTimestamp", tx.createdAt);
            continue;
        }


        // Ignore outgoing transactions
        if (sender.toLowerCase() === process.env.ZKSYNC_BRIDGE_ADDRESS.toLowerCase()) {
            console.log("IGNORE: Outgoing tx");
            await redis.set(`zksync:bridge:${txhash}:processed`, 1);
            await redis.set("zksync:bridge:lastProcessedTimestamp", tx.createdAt);
            continue;
        }

        if (receiver.toLowerCase() !== process.env.ZKSYNC_BRIDGE_ADDRESS.toLowerCase()) {
            console.log(tx);
            throw new Error("ABORT: Receiver does not match wallet");
        }

        // Status is rejected. Mark as processed and update last processed time
        if ((["rejected"]).includes(txStatus)) {
            console.log("Rejected tx");
            await redis.set(`zksync:bridge:${txhash}:processed`, 1);
            await redis.set("zksync:bridge:lastProcessedTimestamp", tx.createdAt);
            continue;
        }
        
        // Status is not committed? Ignore.
        if (!(["committed", "finalized"]).includes(txStatus)) {
            console.log("New transaction found but not committed");
            continue;
        }
        
        // Timestamp > now ? Suspicious. Mark it as processed and don't send funds. 
        // Also update the last processed date to the newest time so nothing before that gets processed just in case
        if (timestamp.getTime() > now.getTime()) {
            console.log("Sent in the future? wtf bro.");
            await redis.set(`zksync:bridge:${txhash}:processed`, 1);
            await redis.set("zksync:bridge:lastProcessedTimestamp", tx.createdAt);
            continue;
        }
        
        // Last processed > timestamp ? Unexpected behavior. Mark as processed and don't apply funds. 
        if (lastProcessedDate.getTime() > timestamp.getTime()) {
            console.log("Timestamp before last processed. Tx got skipped");
            await redis.set(`zksync:bridge:${txhash}:processed`, 1);
            continue;
        }
        
        // Token is not supported ? Mark as processed and continue
        if (!SUPPORTED_TOKEN_IDS.includes(tokenId)) {
            console.log("Transaction from unsupported token", tx);
            await redis.set(`zksync:bridge:${txhash}:processed`, 1);
            await redis.set("zksync:bridge:lastProcessedTimestamp", tx.createdAt);
            continue;
        }
        

        console.log("new tx", tx);

        // Set the tx processed before you do anything to prevent accidental double spends
        await redis.set(`zksync:bridge:${txhash}:processed`, 1);
        await redis.set("zksync:bridge:lastProcessedTimestamp", tx.createdAt);
            
        // Mark the user as having funds ready to use on Arweave
        const dollarValue = (amount / 10**TOKEN_DETAILS[tokenId].decimals).toFixed(2);
        const bytes = dollarValue * 1e6;
        await redis.INCRBY(`zksync:user:${sender}:allocation`, bytes);
    }

    setTimeout(processNewWithdraws, 5000);
}
