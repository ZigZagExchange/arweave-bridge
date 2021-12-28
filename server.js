import express from 'express';
import Arweave from 'arweave';
import ExpressFileUpload from 'express-fileupload';
import * as Redis from 'redis';
import arweaveKey from './arweave_key';


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
app.use(ExpressFileUpload());

app.get("/allocation/zksync", function (req, res) {
    const address = req.params.address;
    const allocation = await redis.get(`zksync:user:${address}:allocation`);
    const response = { "remaining_bytes": allocation };
    return res.status(200).json(response);
}

app.post("/arweave/upload", function (req, res) {
    if (!req.files || Object.keys(req.files).length === 0) {
        return res.status(400).send('No files were uploaded.');
    }
    const file = req.files.file;
    const allocation = await redis.get(`zksync:user:${sender}:allocation`);
    if (!allocation || allocation < file.size) {
        return res.status(402).send(`Insufficient funds for upload. Current allocation size is ${allocation} bytes`);
    }
    await redis.DECR(`zksync:user:${sender}:allocation`, file.size);

    let arweaveTx = await arweave.createTransaction({
        data: file.data
    }, key);
    console.log(arweaveTx);

    const remainingAllocation = allocation - file.size;
    const response = { "arweave_txid": arweaveTx.id, "remaining_bytes": remainingAllocation };
    return res.status(200).json(response);
}
