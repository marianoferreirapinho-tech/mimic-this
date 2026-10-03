const express=require("express");
const http=require("http");
const {Server}=require("socket.io");
const crypto=require("crypto");
const path=require("path");
const app=express(),server=http.createServer(app),io=new Server(server,{cors:{origin:"*"}});
app.get("/health",(req,res)=>res.status(200).json({ok:true,service:"mimic-this"}));
app.use(express.static(path.join(__dirname,"public"),{index:"index.html"}));
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
const games=new Map();
const decks={movies:["Titanic","Toy Story","Frozen","Jaws","Rocky","The Lion King","Home Alone","Jurassic Park"],people:["Taylor Swift","Lionel Messi","Beyoncé","Tom Cruise","Adele","Michael Jordan","Lady Gaga","Dwayne Johnson"]};
const uid=()=>crypto.randomUUID(),code=()=>crypto.randomBytes(3).toString("hex").toUpperCase();
function actor(g){return g.players.find(p=>p.id===g.turn.actorId)}
function eligibleGuessers(g){const a=actor(g);return g.players.filter(p=>a&&p.team===a.team&&p.id!==a.id)}
function categoryMeta(g){return g.category==="movies"?{label:"Movies",theme:"movies"}:g.category==="people"?{label:"Famous People",theme:"people"}:{label:g.categoryName||"Custom",theme:"custom"}}
function view(g,pid){
 const me=g.players.find(p=>p.id===pid),a=actor(g),isActor=me?.id===g.turn.actorId,same=!!(me&&a&&me.team===a.team);
 const canGuess=same&&!isActor,canKnow=isActor||!same;
 return {id:g.id,code:g.code,name:g.name,category:g.category,categoryName:g.categoryName,categoryMeta:categoryMeta(g),guessingTime:g.guessingTime,status:g.status,scores:g.scores,
 players:g.players.map(p=>({id:p.id,name:p.name,team:p.team,acted:p.acted,connected:p.connected})),me,
 turn:{number:g.turn.number,actorId:g.turn.actorId,actorName:a?.name,word:canKnow?g.turn.word:null,videos:g.turn.videos,reactions:g.turn.reactions,guesses:g.turn.guesses,submitted:g.turn.submitted,finalAnswer:g.turn.finalAnswer,result:g.turn.result},
 permissions:{record:isActor,react:!isActor,guess:canGuess,knowWord:canKnow,submitted:!!g.turn.submitted?.[pid]}}
}
function emit(g){for(const p of g.players)if(p.socketId)io.to(p.socketId).emit("game:update",view(g,p.id))}
function chooseActor(g){const m=Math.min(...g.players.map(p=>p.acted));const e=g.players.filter(p=>p.acted===m);return e[Math.floor(Math.random()*e.length)]}
function chooseWord(g){const d=g.category==="custom"?g.customWords:decks[g.category];return d[Math.floor(Math.random()*d.length)]}
function newTurn(g){if(g.turn?.number&&g.players.every(p=>p.acted>=1)){g.status="gameover";return}const a=chooseActor(g);a.acted++;g.turn={number:(g.turn?.number||0)+1,actorId:a.id,word:chooseWord(g),videos:[],reactions:{},guesses:{},submitted:{},finalAnswer:null,result:null};g.status="role"}
function resolve(g){
 const a=actor(g),vals=Object.values(g.turn.guesses).filter(Boolean),counts={};for(const v of vals)counts[v]=(counts[v]||0)+1;
 const ranked=Object.entries(counts).sort((x,y)=>y[1]-x[1]);
 if(!ranked.length)return;
 g.turn.finalAnswer=ranked[0][0];
 g.turn.result=g.turn.finalAnswer.toLowerCase()===g.turn.word.toLowerCase()?"correct":"incorrect";
 if(g.turn.result==="correct")g.scores[a.team]++;
 g.status="reveal";
}
io.on("connection",socket=>{
 socket.on("game:create",({name,playerName,category,categoryName,guessingTime,invitees=[],customWords=[]},cb)=>{
  const gameId=uid(),playerId=uid(),g={id:gameId,code:code(),name:name||"Mimic This! Game",category:category||"movies",categoryName:categoryName||category||"Movies",guessingTime:guessingTime||"30 seconds",customWords:customWords.length?customWords:["Mom","Dad","Grandma","Uncle John"],status:"lobby",scores:{blue:0,purple:0},players:[{id:playerId,name:playerName||"You",team:"blue",acted:0,socketId:socket.id,connected:true}],turn:{number:0,actorId:null,word:null,videos:[],reactions:{},guesses:{},submitted:{},finalAnswer:null,result:null}};
  invitees.forEach((n,i)=>g.players.push({id:uid(),name:n,team:i%2?"blue":"purple",acted:0,socketId:null,connected:false}));games.set(gameId,g);socket.join(gameId);cb?.({gameId,playerId,code:g.code});emit(g);
 });
 socket.on("game:join",({code:joinCode,name},cb)=>{const g=[...games.values()].find(x=>x.code===String(joinCode).toUpperCase());if(!g)return cb?.({error:"Game not found"});let p=g.players.find(x=>x.name.toLowerCase()===String(name).toLowerCase()&&!x.connected);if(!p){p={id:uid(),name:name||"Player",team:g.players.filter(x=>x.team==="blue").length<=g.players.filter(x=>x.team==="purple").length?"blue":"purple",acted:0};g.players.push(p)}p.socketId=socket.id;p.connected=true;socket.join(g.id);cb?.({gameId:g.id,playerId:p.id});emit(g)});
 socket.on("game:resume",({gameId,playerId})=>{const g=games.get(gameId),p=g?.players.find(x=>x.id===playerId);if(!g||!p)return;p.socketId=socket.id;p.connected=true;socket.join(g.id);emit(g)});
 socket.on("game:start",({gameId})=>{const g=games.get(gameId);if(!g)return;newTurn(g);emit(g)});
 socket.on("role:ready",({gameId,playerId})=>{const g=games.get(gameId);if(!g||g.status!=="role"||g.turn.actorId!==playerId)return;g.status="record";emit(g)});
 socket.on("turn:recorded",({gameId,playerId,videoLabel})=>{const g=games.get(gameId);if(!g||g.status!=="record"||g.turn.actorId!==playerId||g.turn.videos.length>=3)return;g.turn.videos.push(videoLabel||`Video ${g.turn.videos.length+1}`);emit(g)});
 socket.on("recording:finish",({gameId,playerId})=>{const g=games.get(gameId);if(!g||g.turn.actorId!==playerId||!g.turn.videos.length)return;g.status="watch";emit(g)});
 socket.on("watch:done",({gameId})=>{const g=games.get(gameId);if(!g||g.status!=="watch")return;g.status="guess";emit(g)});
 socket.on("reaction:add",({gameId,playerId,emoji})=>{const g=games.get(gameId);if(!g||playerId===g.turn.actorId)return;g.turn.reactions[playerId]=emoji;emit(g)});
 socket.on("guess:submit",({gameId,playerId,answer})=>{const g=games.get(gameId);if(!g||g.status!=="guess")return;const me=g.players.find(p=>p.id===playerId),a=actor(g);if(!me||!a||me.id===a.id||me.team!==a.team||g.turn.submitted[playerId])return;const v=String(answer||"").trim();if(!v)return;g.turn.guesses[playerId]=v;g.turn.submitted[playerId]=true;const e=eligibleGuessers(g);if(e.length&&e.every(p=>g.turn.submitted[p.id]))resolve(g);emit(g)});
 socket.on("turn:next",({gameId})=>{const g=games.get(gameId);if(!g||g.status!=="reveal")return;newTurn(g);emit(g)});
 socket.on("disconnect",()=>{for(const g of games.values()){const p=g.players.find(x=>x.socketId===socket.id);if(p){p.connected=false;emit(g)}}});
});
const PORT=Number(process.env.PORT)||10000;
server.listen(PORT,"0.0.0.0",()=>console.log(`Mimic This! listening on 0.0.0.0:${PORT}`));