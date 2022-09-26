const puppeteer = require('puppeteer');
const fs = require('fs');
const { initializeApp, applicationDefault, cert } = require('firebase-admin/app');
const { getFirestore, Timestamp, FieldValue } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');


let uploadedImgs = [];
let uploadedDocs = [];
let headless = false;

const under = async()=>{
    const serviceAccount = require('./creds.json');
    const admin = require('firebase-admin');


    if(!admin.apps.length){
        await admin.initializeApp({
            credential: cert(serviceAccount),
            storageBucket: 'rompekbezas-f7a58.appspot.com'
        });
    }
      
    const db = getFirestore();
    const stg = getStorage()

    const browser = await puppeteer.launch( { 
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        headless:headless
    })


    const page = await browser.newPage();
    const client = await page.target().createCDPSession()
    page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/73.0.3641.0 Safari/537.36")

    const updateStatus = async(status) => {
        await db.collection('status').doc('RPK').set({
            status:status
        }).then(()=>{console.log("Estado actualizado")})
    }


    await page.goto('https://web.whatsapp.com/')
    page.setViewport({ width: 1024, height: 900 })
    try{
        await updateStatus('Cargando, por favor espera');
        console.log("Esperando elemento de QR")
        await page.waitForSelector("[aria-label='Scan me!']")
        console.log("Por favor escanea el codigo para proseguir")
        //Screenshot del QR, este es subido al storage
        await page.screenshot({path:"QR.png", fullPage:true})
        let QRPage = await browser.newPage()
        let response = await QRPage.goto(`file://${process.cwd()}/QR.png`)
        let QRBuffer = await response.buffer()

        await stg.bucket().file('QRCODE/QR.png').save(QRBuffer).then((data)=>{
            console.log("Codigo QR subido al storage")
            updateStatus('¡QR actualizado!');
            QRPage.close()
        })

        await page.waitForFunction("document.querySelector('._2UwZ_') === null")
        console.log("Cargando mensajes")
        await updateStatus('Escaneado con exito, cargando mensajes...');
    }catch(error){
        if(error.message == "waiting for function failed: timeout 30000ms exceeded"){
            console.log("No escaneaste el codigo, reiniciando...")
            await updateStatus('No escaneaste el codigo, reiniciando...');
            browser.close()
            under();
            return 0;
        }
    }
    
    //Generar nombre de imagen
    const nameGenerate = () => {
        let chars = "abcdefghijklmnopqrstuvwxyz0123456789"
        let name = ""
        for(let i = 0; i < 6; i ++){
            name += chars[Math.floor(Math.random() * chars.length)]
        }

        return name;
    }

    //Agregar ruta de la imagen en Firestore a su respectivo usuario
    const addDataToDatabase = async(doc, data, type, albumName) => {
        await db.collection("RPK").doc(doc).get().then(async(dataf)=>{
            if(!dataf.exists){
                await db.collection("RPK").doc(doc).set({files:[]});
                await db.collection("RPK").doc(doc).update({
                    name:doc,
                    files:FieldValue.arrayUnion({
                        src:data,
                        type:type,
                        albumName:albumName != undefined ? albumName : "none"
                    }),
                })
            }
        })

        await db.collection("RPK").doc(doc).update({
            name:doc,
            files:FieldValue.arrayUnion({
                src:data,
                type:type,
                albumName:albumName != undefined ? albumName : "none"
                }),
        })
    }



    //Ver si la foto es repetida
    const repeatedImg = (data) => {
        for(let i = 0; i < uploadedImgs.length; i++){
            if(data.person == uploadedImgs[i].person && data.img == uploadedImgs[i].img){
                return true
            }
        }
        return false;
    }

    const repeatedDocs = (data) => {
        for(let i = 0; i < uploadedDocs.length; i++){
            if(data.person == uploadedDocs[i].person && data.doc == uploadedDocs[i].doc){
                return true
            }
        }
        return false;
    }

    //Subir foto
    const uploadPicture = async(img, person, name, albumName) => {
        let iPage = await browser.newPage()
        try{
            let response = await iPage.goto(img)
            let imgBuffer = await response.buffer()

            if(!repeatedImg({img:imgBuffer.toString(), person:person})){
                console.log("Subiendo imagen '" + name + "' de " + person)
                await stg.bucket().file(person + '/' + name + '.png').save(imgBuffer).then((data)=>{
                    addDataToDatabase(person, person + '/' + name + '.png', "image", albumName)
                })
                uploadedImgs.push({img:imgBuffer.toString(), person:person})
            }else{
                console.log("Ya he subido esta imagen")
            }
            await iPage.close()
        }catch(error){
            console.log("No he podido subir esta imagen de " + person)
            iPage.close()
        }
    }

    //Subir Documento
    const uploadDoc = async(path, person, name) => {
        let data = await fs.readFileSync(path)
        await stg.bucket().file(person + '/' + name).save(data).then((data)=>{
            addDataToDatabase(person, person + '/' + name, "doc")
        })

        uploadedDocs.push({person:person, doc:name})
    }

    const mainFunction = async() =>{
        await page.reload({ waitUntil: ["networkidle0", "domcontentloaded"] });
        try{
        await page.waitForSelector("span[class='ggj6brxn gfz4du6o r7fjleex g0rxnol2 lhj4utae le5p0ye3 l7jjieqr i0jNr']", {timeout:120000})
        }catch{
            browser.close()
            under();
            console.log("Navegador incompatible")
            return 0;
        }
        await updateStatus('Reinicializando');
        await page.waitForTimeout(3000)


        const actChats = await page.evaluate(()=>{
            const chats = document.querySelectorAll("._2nY6U")
            const test = document.querySelector("#pane-side > div > div > div")
            const childs = test.childNodes

            const ct = []

            childs.forEach((node)=>{
                console.log(node)
                let isMarket = false;
                if(node.querySelector("span[data-testid='pinned2']") !== null){
                    isMarket = true;
                }
                let title = node.querySelector('span.ggj6brxn').title
                ct.push({
                    person:title,
                    isMarket:isMarket
                })
            })

            return ct;
        })
    
        
            let fixArray = actChats.slice(0, 11).reverse().slice(0, 10)
            let cont = 0;

            for(item of fixArray){
                if(!item.isMarket){
                    try{
                        await page.waitForSelector("[title='" + item.person + "']")
                        await page.click("[title='" + item.person + "']")
                        await page.waitForTimeout(1500);
                        let downloadPhotos = await page.evaluate(()=>{
                            let result = []
                            let photos = document.querySelectorAll("div[data-testid='media-state-download']");
                            console.log(photos)
                            for(item of photos){
                                console.log(item.parentNode.querySelector('img'));
                                if(item.parentNode.querySelector('img') !== null){
                                    result.push(item.parentNode.querySelector('img').src)
                                }
                            }
                            return result;
                        })

                        for(let ditem = 0; ditem < downloadPhotos.length; ditem++){
                            try{
                            await page.waitForSelector("img[src='" + downloadPhotos[ditem] + "']",{timeout: 500})
                            await page.click("img[src='" + downloadPhotos[ditem] + "']")
                            }catch{
                                console.log("No he encontrado esta foto, lo intentaré en la siguiente")
                                await updateStatus('La foto de '+ item.person + " ya no es accesible y necesita volver a enviarse");
                            }
                        }
                    }catch{
                        console.log("Chat guardado pero no encontrado");
                        updateStatus("El chat: " + item.person + " aparecerá en la siguiente inicializacion")
                    }
                }
            }

            for(item of fixArray){
                if(!item.isMarket){
                    console.log(item.person)
                    updateStatus("Sincronizando con " + item.person)
                    try{
                        await page.waitForSelector("[title='" + item.person + "']",{timeout:1000})
                        await page.click("[title='" + item.person + "']");
                        await page.click("[title='" + fixArray[fixArray.length -1].person + "']");
                        await page.click("[title='" + item.person + "']");

                        let gmsg = await page.evaluate((item)=>{
                            let msgs = document.querySelectorAll("img.jciay5ix");
                            let docs = document.querySelectorAll("button[class='i5tg98hk f9ovudaz przvwfww gx1rr48f shdiholb phqmzxqs gtscxtjd ajgl1lbb thr4l2wc cc8mgx9x eta5aym1 d9802myq e4xiuwjv cm280p3y p357zi0d f8m0rgwh elxb2u3l ln8gz9je gfz4du6o r7fjleex tffp5ko5 l8fojup5 paxyh2gw']");
                        
                            let result = {
                                contact:item,
                                imgs:[],
                                docs:[]
                            }

                            if(msgs !== null){
                                for(let i = 0; i < msgs.length; i++){
                                    let isAlbum = false;
                                    parent = msgs[i].parentNode.parentNode.parentNode.parentNode.parentNode.parentNode.parentNode.parentNode;

                                    if(parent.classList.contains("_1QR4J")){
                                        isAlbum = true;
                                    }
                                    if(/blob:https/.test(msgs[i].src)){
                                        result.imgs.push({
                                            isAlbum:isAlbum,
                                            person:"Under",
                                            img:msgs[i].src
                                        })
                                    }
                                }

                                for(let i = 0; i < docs.length; i++){
                                    console.log(docs[i].title)
                                    result.docs.push(docs[i].title)
                                }
                            }

                            return result;
                        }, item)

                        for(let item = 0; item < gmsg.imgs.length; item ++){
                            if(/blob:https/.test(gmsg.imgs[item].img)){
                                //Si no es un album de imagenes
                                if(!gmsg.imgs[item].isAlbum){
                                    await uploadPicture(gmsg.imgs[item].img, gmsg.contact.person, nameGenerate())
                                    cont ++;
                                }else{
                                //Si es un album de imagenes
                                    await page.waitForSelector("img[src='" + gmsg.imgs[item].img + "']")
                                    await page.click("img[src='" + gmsg.imgs[item].img + "']");

                                    let photos = await page.evaluate(()=>{
                                        let number = document.querySelector("._2Naut");
                                        number = number.textContent.split(" ");
                                        return parseInt(number[2]);
                                    })
                                    let albumName = nameGenerate();

                                    let firstImg = await page.evaluate(()=>{
                                        return document.querySelector('img.gndfcl4n').src;
                                    })
                                    await uploadPicture(firstImg, gmsg.contact.person, nameGenerate(), albumName)
                                    cont ++;
                                    
                                    for(let i = 1; i < photos; i ++){
                                        await page.waitForSelector("span[data-testid='chevron-right']")
                                        await page.click("span[data-testid='chevron-right']");
                                        let nextPics = await page.evaluate((albumPics)=>{
                                            return document.querySelector('img.gndfcl4n').src;
                                        })
                                        await uploadPicture(nextPics, gmsg.contact.person, nameGenerate(), albumName)
                                        cont ++;
                                    }

                                    await page.click("span[data-testid='x-viewer']");
                                    await page.waitForTimeout(2000)
                                    item+=3;
                                }
                            }
                        }

                        for(let i = 0; i < gmsg.docs.length; i++){
                            let downloadPath = process.cwd() + '\\docs\\' + gmsg.contact.person

                            await client.send('Page.setDownloadBehavior',{
                                behavior: "allow",
                                downloadPath: downloadPath
                            })
                            let fileName = gmsg.docs[i].split("“")
                            fileName = fileName[1].replace("”", "")

                            if(!repeatedDocs({person:gmsg.contact.person, doc:fileName})){
                                await page.click("button[title='" + gmsg.docs[i] + "']")
                                await page.waitForTimeout(5000)
                                await uploadDoc(downloadPath + "\\" + fileName, gmsg.contact.person, fileName)
                            }else{
                                console.log("Ya he subido este documento")
                            }
                        }
                    }catch(error){
                        console.log(error)
                        console.log("No he encontrado este chat, parece que el nombre ha cambiado duarnte la ejecución")
                    }
                }
            }
            await mainFunction()
    }

    try{
        await mainFunction()
    }catch(error){
        console.log("Algo ha fallado en el protocolo, reinicializando...")
        await updateStatus("Estoy desconectado :(");
        console.log(error)
    }
};
under();
module.exports = {under:under};