import { FormData } from 'formdata-node';
import {fileFromPath} from "formdata-node/file-from-path"
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import ethers from 'ethers';

dotenv.config();

if (!process.env.ETH_PRIVKEY) throw new Error("Must set ETH_PRIVKEY in environment");
const ethWallet = new ethers.Wallet(process.env.ETH_PRIVKEY);

const timestamp = Date.now();
const sender = "0x1998CA1E0e9D4a767359464dee60D15daa372cd1";
const message = `${sender}:${timestamp}`;
const signedMessage = await ethWallet.signMessage(message);
const signer = ethers.utils.verifyMessage(message, signedMessage);

const form = new FormData();
form.set("sender", sender);
form.set("timestamp", timestamp);
form.set("signedMessage", signedMessage);
form.set("file", await fileFromPath('sample_upload.json'));

fetch('http://localhost:3000/arweave/upload', {
    method: 'POST',
    body: form
})
.then(res => res.json())
.then(console.log);
