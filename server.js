import express from 'express';
import Arweave from 'arweave';
import * as Redis from 'redis';
import fsPromises from 'fs/promises';
import multer from 'multer';
import dotenv from 'dotenv';

dotenv.config();

const arweaveKey = JSON.parse(await fsPromises.readFile("arweave_key.json"));

// Set up multer
const upload = multer({ storage: multer.memoryStorage()});

// Connect to Arweave
const arweave = Arweave.init({
    host: '127.0.0.1',
    port: 1984,
    protocol: 'http'
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
    const address = req.query.address;
    const allocation = await redis.get(`zksync:user:${address}:allocation`) || 0;
    const response = { "remaining_bytes": allocation };
    return res.status(200).json(response);
});

app.post("/arweave/upload", upload.single('file'), async function (req, res) {
    if (!req.files || Object.keys(req.files).length === 0) {
        return res.status(400).send('No files were uploaded.');
    }
    const file = req.file;
    const allocation = await redis.get(`zksync:user:${sender}:allocation`);
    if (!allocation || allocation < file.size) {
        return res.status(402).send(`Insufficient funds for upload. Current allocation size is ${allocation} bytes`);
    }

    const signature = req.body.signedMessage;
    const user = req.body.user;
    const expectedMessage = `${user}:${timestamp}:${allocation}`;
    await redis.DECR(`zksync:user:${sender}:allocation`, file.size);

    let arweaveTx = await arweave.createTransaction({
        data: file.buffer
    }, key);
    console.log(arweaveTx);

    const remainingAllocation = allocation - file.size;
    const response = { "arweave_txid": arweaveTx.id, "remaining_bytes": remainingAllocation };
    return res.status(200).json(response);
});

app.listen(process.env.PORT || 3000);
