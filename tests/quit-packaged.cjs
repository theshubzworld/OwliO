(async()=>{
  const pages=await(await fetch('http://127.0.0.1:9338/json/list')).json();
  const ws=new WebSocket(pages[0].webSocketDebuggerUrl);
  await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}));
  ws.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.id===1){if(data.result?.exceptionDetails)console.error(data.result.exceptionDetails);ws.close();}});
  ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:'process.mainModule.require("electron").app.quit()'}}));
})().catch(error=>{console.error(error);process.exitCode=1;});
