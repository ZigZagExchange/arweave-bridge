import express from 'express';
import Arweave from 'arweave';
import * as Redis from 'redis';
import fsPromises from 'fs/promises';
import multer from 'multer';
import dotenv from 'dotenv';
import ethers from 'ethers';

dotenv.config();

const arweaveKey = JSON.parse(await fsPromises.readFile("arweave_key.json"));

// Set up multer
const upload = multer({ storage: multer.memoryStorage()});

// Connect to Arweave
const arweave = Arweave.init({
    host: 'arweave.net',
    port: 443,
    protocol: 'https'
});

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


// Application
const app = express();

app.get("/time", async function (req, res) {
    const now = Date.now() / 1000 | 0;
    return res.status(200).json({ "time": now });
});

app.get("/allocation/zksync", async function (req, res) {
    const address = req.query.address.toLowerCase();
    const allocation = await redis.get(`zksync:user:${address}:allocation`) || 0;
    const response = { "remaining_bytes": allocation };
    return res.status(200).json(response);
});

app.post("/arweave/upload", upload.single('file'), async function (req, res) {
    if (!req.file) {
        return res.status(400).send({ error: 'No files were uploaded.'});
    }
    if (!req.body.sender) {
        return res.status(400).send({ error: 'sender is missing' });
    }
    const sender = req.body.sender.toLowerCase();
    const file = req.file;
    const allocation = await redis.get(`zksync:user:${sender}:allocation`) || 0;
    if (!allocation || allocation < file.size) {
        return res.status(402).send({ error: `Insufficient funds for upload. Current allocation size is ${allocation} bytes` });
    }

    const signature = req.body.signedMessage;
    const timestamp = parseInt(req.body.timestamp) || 0;
    const now = Date.now();
    if (Math.abs(timestamp - now) > 30000) {
        return res.status(400).send({ error: 'Timestamp is out of date. Check GET /time for server time'});
    }
    
    // Replay protection
    const alreadyUploaded = await redis.GET(`zkysnc:arweave:upload:${sender}:${timestamp}`);
    if (alreadyUploaded) {
        return res.status(400).send({ error: 'Cannot re-use timestamp. Generate a new one.'});
    }
    await redis.SET(`zkysnc:arweave:upload:${sender}:${timestamp}`, 1);
    await redis.EXPIRE(`zkysnc:arweave:upload:${sender}:${timestamp}`, 600);


    // Verify signature
    const expectedMessage = `${req.body.sender}:${timestamp}`;
    const signingAddress = ethers.utils.verifyMessage(expectedMessage, signature);
    if (signingAddress.toLowerCase() !== sender) {
        return res.status(400).send({ error: 'Bad signature'});
    }

    // Decrease allocation
    await redis.DECRBY(`zksync:user:${sender}:allocation`, file.size);

    const arweaveTx = await arweave.createTransaction({
        data: file.buffer
    }, arweaveKey);
    const signedTx = await arweave.transactions.sign(arweaveTx, arweaveKey);
    let uploader = await arweave.transactions.getUploader(arweaveTx);
    while (!uploader.isComplete) {
      await uploader.uploadChunk();
      console.log(`${uploader.pctComplete}% complete, ${uploader.uploadedChunks}/${uploader.totalChunks}`);
    }
    console.log(arweaveTx);

    const remainingAllocation = allocation - file.size;
    const response = { "arweave_txid": arweaveTx.id, "remaining_bytes": remainingAllocation };
    return res.status(200).json(response);
});

app.listen(process.env.PORT || 3000);
