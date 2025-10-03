// Echo Maze - game.js
// Controls: Arrow keys / WASD to move. Space to spawn an echo (it will replay your last 3 seconds).
// R to restart level.

// Canvas setup
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');

const TILE = 40; // size of grid tile
const COLS = 20; // width = 800 -> 20 tiles
const ROWS = 14; // height = 560 -> 14 tiles

// Entities storage
let player, echoes, boxes, switches, door;
let keys = {};
let lastFrame = 0;
let levelIndex = 0;
const levelNumLabel = document.getElementById('level-num');
const messageDiv = document.getElementById('message');
const nextButton = document.getElementById('next-level');

const LEVELS = [
  // Level 1: simple: use an echo to press switch to open door
  {
    grid: [],
    player: {x:1, y:6},
    boxes: [],
    switches: [{x:9, y:6, id:0}],
    door: {x:19, y:6, open:false},
    text: "Spawn an echo to press the switch."
  },
  // Level 2: echo must push a box onto switch
  {
    player: {x:1,y:6},
    boxes: [{x:8,y:6}],
    switches: [{x:12,y:6,id:0}],
    door: {x:19,y:6,open:false},
    text:"Use echoes to push boxes onto switches."
  },
  // Level 3: two switches, one controlled by player, one by echo
  {
    player: {x:2,y:6},
    boxes: [{x:7,y:6}],
    switches: [{x:12,y:4,id:0},{x:12,y:8,id:1}],
    door: {x:19,y:6,open:false},
    text:"Coordinate yourself and an echo to flip two switches."
  },
  // Level 4: moving puzzle - small maze
  {
    player:{x:1,y:1},
    boxes:[],
    switches:[{x:17,y:12,id:0}],
    door:{x:19,y:13,open:false},
    walls: [
      // create a snaking wall
      ...Array.from({length:12},(_,i)=>({x:2+i,y:3})),
      ...Array.from({length:8},(_,i)=>({x:14,y:3+i})),
      ...Array.from({length:10},(_,i)=>({x:4+i,y:10}))
    ],
    text:"Navigate tight corridors; echoes can squeeze where you cannot."
  }
];

function initLevel(i){
  const L = LEVELS[i];
  player = new Player(L.player.x, L.player.y);
  echoes = [];
  boxes = (L.boxes || []).map(b => new Box(b.x,b.y));
  switches = (L.switches || []).map(s => new Switch(s.x,s.y,s.id));
  door = new Door(L.door.x, L.door.y, L.door.open || false);
  walls = (L.walls || []).map(w => ({x:w.x,y:w.y}));
  messageDiv.textContent = L.text || "";
  levelNumLabel.textContent = (i+1);
  nextButton.style.display = "none";
}

class Player {
  constructor(x,y){
    this.x = x; this.y = y;
    this.radius = TILE*0.35;
    this.speed = 6; // pixels per frame approx
    // movement buffer: store positions for echo replay (record last N ms)
    this.recording = []; // {t, x, y}
    this.maxRecordMs = 3000;
  }
  pos(){ return {x:this.x, y:this.y}; }
  update(dt){
    // dt in seconds, use speed in tiles per second -> convert to pixels
    const movePx = this.speed * TILE * dt;
    let dx = 0, dy = 0;
    if (keys.ArrowLeft || keys.a) dx -= 1;
    if (keys.ArrowRight || keys.d) dx += 1;
    if (keys.ArrowUp || keys.w) dy -= 1;
    if (keys.ArrowDown || keys.s) dy += 1;
    // normalize
    if (dx !== 0 || dy !== 0){
      const len = Math.hypot(dx,dy);
      dx = dx/len * movePx;
      dy = dy/len * movePx;
      attemptMove(this, dx, dy);
    }
    // record (timestamp in ms)
    const now = performance.now();
    this.recording.push({t:now, x:this.x, y:this.y});
    // trim
    while(this.recording.length && now - this.recording[0].t > this.maxRecordMs){
      this.recording.shift();
    }
  }
  draw(){
    ctx.save();
    ctx.translate(this.x, this.y);
    // body
    ctx.fillStyle = '#ffd166';
    circle(0,0,this.radius);
    // face (simple)
    ctx.fillStyle = '#2b2b2b';
    ctx.fillRect(-6, -4, 4, 3);
    ctx.fillRect(2, -4, 4, 3);
    ctx.restore();
  }
  spawnEcho(){
    // copy recording and create an Echo that will replay them over maxRecordMs timeline
    if (this.recording.length < 5) return null; // too short
    // produce relative timeline starting at 0
    const startT = this.recording[0].t;
    const frames = this.recording.map(r => ({t: r.t - startT, x:r.x, y:r.y}));
    const total = frames[frames.length-1].t;
    const e = new Echo(frames, total);
    echoes.push(e);
    return e;
  }
}

class Echo {
  constructor(frames, totalMs){
    this.frames = frames; // array {t,x,y}
    this.total = totalMs;
    this.age = 0; // ms since spawn playback
    // start at first recorded pos
    this.x = frames[0].x; this.y = frames[0].y;
    this.radius = TILE*0.28;
    this.alive = true;
  }
  update(dt){
    if (!this.alive) return;
    this.age += dt*1000;
    if (this.age > this.total + 50){
      // lifetime ended
      this.alive = false;
      return;
    }
    // find interpolated position for current age
    const t = Math.min(this.age, this.total);
    // find frames surrounding t
    let i = 0;
    while(i < this.frames.length -1 && this.frames[i+1].t < t) i++;
    const a = this.frames[i];
    const b = this.frames[Math.min(i+1, this.frames.length-1)];
    const span = b.t - a.t || 1;
    const f = (t - a.t)/span;
    this.x = lerp(a.x, b.x, f);
    this.y = lerp(a.y, b.y, f);

    // echoes should interact physically: push boxes or flip switches if overlapping
    // push boxes
    for (let box of boxes){
      const dx = box.x - this.x;
      const dy = box.y - this.y;
      const dist = Math.hypot(dx,dy);
      const min = TILE*0.5;
      if (dist < min){
        // push in direction of movement (approx)
        const dirx = (b.x - a.x) || (dx>0?0.1:-0.1);
        const diry = (b.y - a.y) || (dy>0?0.1:-0.1);
        const pushX = Math.sign(dirx);
        const pushY = Math.sign(diry);
        attemptGridPush(box, pushX, pushY);
      }
    }

    // triggers: switch
    for (let sw of switches){
      if (Math.hypot(sw.x*TILE + TILE/2 - this.x, sw.y*TILE + TILE/2 - this.y) < TILE*0.45){
        sw.triggerByEcho();
      }
    }
  }
  draw(){
    if (!this.alive) return;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.globalAlpha = 0.85;
    // pulsing ring
    const pulse = 1 + 0.08*Math.sin(this.age/120);
    ctx.beginPath();
    ctx.arc(0,0,this.radius*pulse,0,Math.PI*2);
    ctx.fillStyle = 'rgba(139,211,199,0.6)';
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

class Box {
  constructor(gridX, gridY){
    this.gx = gridX; this.gy = gridY;
    this.x = gridX * TILE + TILE/2;
    this.y = gridY * TILE + TILE/2;
    this.w = TILE*0.9; this.h = TILE*0.9;
  }
  draw(){
    ctx.save();
    ctx.translate(this.x, this.y);
    roundRect(-this.w/2, -this.h/2, this.w, this.h, 6);
    ctx.fillStyle = '#c08497';
    ctx.fill();
    ctx.restore();
  }
  setGrid(gx,gy){
    this.gx=gx; this.gy=gy;
    this.x = gx*TILE + TILE/2;
    this.y = gy*TILE + TILE/2;
  }
}

class Switch {
  constructor(gx,gy,id){
    this.gx = gx; this.gy = gy; this.id = id;
    this.x = gx*TILE + TILE/2; this.y = gy*TILE + TILE/2;
    this.activatedBy = {player:false, echo:false, box:false};
  }
  reset(){ this.activatedBy = {player:false, echo:false, box:false}; }
  triggerByEcho(){ this.activatedBy.echo = true; }
  triggerByPlayer(){ this.activatedBy.player = true; }
  triggerByBox(){ this.activatedBy.box = true; }
  isActive(){
    // active if any one triggered
    return this.activatedBy.echo || this.activatedBy.player || this.activatedBy.box;
  }
  draw(){
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.strokeStyle = '#163b36';
    ctx.fillStyle = this.isActive() ? '#67e6c1' : '#113140';
    roundRect(-TILE*0.4, -TILE*0.4, TILE*0.8, TILE*0.8, 6);
    ctx.fill();
    ctx.restore();
  }
}

class Door {
  constructor(gx,gy,open){
    this.gx = gx; this.gy = gy; this.open = open;
    this.x = gx*TILE; this.y = gy*TILE;
  }
  draw(){
    if (this.open) return;
    ctx.save();
    ctx.fillStyle = '#2b3440';
    ctx.fillRect(this.x, this.y, TILE, TILE);
    ctx.fillStyle = '#7b8ea0';
    ctx.fillRect(this.x+4, this.y+8, TILE-8, TILE-16);
    ctx.restore();
  }
  blockAt(x,y){ // grid coords
    return !this.open && x===this.gx && y===this.gy;
  }
}

// utilities
function lerp(a,b,t){ return a + (b-a)*t; }
function circle(x,y,r){ ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill(); }
function roundRect(x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }

// basic collision grid helpers
function gridAtPixel(px, py){
  const gx = Math.floor(px / TILE);
  const gy = Math.floor(py / TILE);
  return {gx,gy};
}
function isWallAt(gx,gy){
  if (gx < 0 || gx >= COLS || gy < 0 || gy >= ROWS) return true;
  // walls array
  for (let w of (walls || [])){
    if (w.x === gx && w.y === gy) return true;
  }
  // door
  if (door && door.blockAt(gx,gy)) return true;
  return false;
}
function boxAtGrid(gx,gy){
  return boxes.find(b => b.gx===gx && b.gy===gy);
}

function attemptGridPush(box, pushX, pushY){
  // try to push box one tile in direction if free
  const nx = box.gx + pushX;
  const ny = box.gy + pushY;
  if (isWallAt(nx,ny)) return false;
  if (boxAtGrid(nx,ny)) return false;
  // move box
  box.setGrid(nx,ny);
  // check if now overlapping a switch
  for (let sw of switches){
    if (sw.gx===box.gx && sw.gy===box.gy) sw.triggerByBox();
  }
  return true;
}

function attemptMove(entity, dx, dy){
  // move entity in pixels (player), but snapped around grid/walls/boxes
  const nx = entity.x + dx;
  const ny = entity.y + dy;
  // find grid cell of new position
  const g = gridAtPixel(nx, ny);
  // if center position collides with wall
  if (isWallAt(g.gx, g.gy)) return;
  // if collides with box, try to push
  const box = boxAtGrid(g.gx, g.gy);
  if (box){
    const pushX = Math.sign(dx);
    const pushY = Math.sign(dy);
    // if moving diagonally, prefer primary axis
    if (Math.abs(dx) > Math.abs(dy)) pushY = 0;
    if (!attemptGridPush(box, pushX, pushY)){
      return; // blocked
    }
  }
  // OK move
  entity.x = nx;
  entity.y = ny;

  // if entity is player, check switches
  if (entity instanceof Player){
    for (let sw of switches){
      const dist = Math.hypot(sw.x - entity.x, sw.y - entity.y);
      if (dist < TILE*0.45) sw.triggerByPlayer();
    }
  }
}

function checkLevelComplete(){
  // level complete when all switches are activated and player reaches door tile (or door open + player in final cell)
  const allOn = switches.every(s => s.isActive());
  if (allOn) door.open = true;
  // if player is inside door grid
  const pg = gridAtPixel(player.x, player.y);
  if (door.open && pg.gx === door.gx && pg.gy === door.gy){
    return true;
  }
  return false;
}

// input handlers
window.addEventListener('keydown', (e)=>{
  keys[e.key] = true;
  if (e.key === ' '){
    // spawn echo
    player.spawnEcho();
  } else if (e.key === 'r' || e.key === 'R'){
    initLevel(levelIndex);
  }
});
window.addEventListener('keyup', (e)=>{
  keys[e.key] = false;
});

// main loop
function updateFrame(ts){
  if (!lastFrame) lastFrame = ts;
  const dt = (ts - lastFrame)/1000;
  lastFrame = ts;

  // update
  player.update(dt);
  for (let e of echoes) e.update(dt);
  echoes = echoes.filter(e => e.alive);

  // update triggers for boxes (boxes resting on switch)
  for (let sw of switches) sw.reset(); // reset then re-evaluate
  // player triggers
  for (let sw of switches){
    const d = Math.hypot(sw.x - player.x, sw.y - player.y);
    if (d < TILE*0.45) sw.triggerByPlayer();
  }
  // boxes trigger
  for (let b of boxes){
    for (let sw of switches){
      if (b.gx === sw.gx && b.gy === sw.gy) sw.triggerByBox();
    }
  }

  // check win
  const done = checkLevelComplete();
  if (done){
    messageDiv.textContent = "Level complete! 🎉";
    nextButton.style.display = levelIndex < LEVELS.length-1 ? "inline-block":"inline-block";
    nextButton.textContent = levelIndex < LEVELS.length-1 ? "Next Level" : "Restart";
    // pause progression while showing next button - but we still animate for visuals
  }

  // draw
  draw();

  requestAnimationFrame(updateFrame);
}

function drawGrid(){
  // subtle grid tiles
  for (let y=0;y<ROWS;y++){
    for (let x=0;x<COLS;x++){
      const px = x*TILE, py = y*TILE;
      // background tile
      ctx.fillStyle = (x+y)%2 ? '#0f2630' : '#0b1c26';
      ctx.fillRect(px,py,TILE,TILE);
      // optional thin grid lines
      ctx.strokeStyle = 'rgba(255,255,255,0.02)';
      ctx.strokeRect(px+0.5,py+0.5,TILE-1,TILE-1);
    }
  }
  // walls
  ctx.fillStyle = '#12202a';
  for (let w of (walls || [])){
    ctx.fillRect(w.x*TILE, w.y*TILE, TILE, TILE);
  }
}

function draw(){
  // clear
  ctx.clearRect(0,0,canvas.width, canvas.height);

  // grid
  drawGrid();

  // draw door
  door.draw();

  // draw switches
  for (let sw of switches) sw.draw();

  // draw boxes
  for (let b of boxes) b.draw();

  // draw echoes behind player
  for (let e of echoes) e.draw();

  // draw player
  player.draw();

  // HUD: echo count
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(12, canvas.height - 46, 160, 34);
  ctx.fillStyle = '#e7f7f2';
  ctx.font = '14px system-ui';
  ctx.fillText(`Echoes active: ${echoes.length}`, 20, canvas.height - 24);
  ctx.restore();
}

// start
initLevel(levelIndex);
requestAnimationFrame(updateFrame);

// next button
nextButton.addEventListener('click', ()=>{
  if (levelIndex < LEVELS.length -1){
    levelIndex++;
  } else {
    levelIndex = 0;
  }
  initLevel(levelIndex);
});
