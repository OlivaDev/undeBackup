const express = require('express');
const under = require('./main');

const app = express();

app.get('/', async(res, error)=>{
    const response = await under();
})

const PORT = process.env.PORT || 3000;

app.listen(PORT,(err)=>{
    if(err) throw err;
    console.log("Current Port: " + PORT)
})