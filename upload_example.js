import { FormData } from 'formdata-node';
import {fileFromPath} from "formdata-node/file-from-path"
import fetch from 'node-fetch';

const form = new FormData();
form.set("sender", "0x1998CA1E0e9D4a767359464dee60D15daa372cd1");
form.set("timestamp", Date.now());
form.set("file", await fileFromPath('sample_upload.json'));

fetch('http://localhost:3000/arweave/upload', {
    method: 'POST',
    body: form
})
.then(res => res.json())
.then(console.log);


