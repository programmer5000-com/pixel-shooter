// the most time to wait for a pong before closing the connection.
const MAX_CONNECTION_BROKEN_WAIT = 5 * 1000;

// 1 out of every n ticks is sent to the client.
const tickSkip = 1;
const WebSocket = require("ws");

const wss = new WebSocket.Server({ port: process.env.PORT || 5000, host: process.env.HOST || "127.0.0.1" });

const mainEmitter = require("./index.js");

const convertBase = (value, from_base, to_base) => {
  value = value.toString();
  var range = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+/".split("");
  var from_range = range.slice(0, from_base);
  var to_range = range.slice(0, to_base);

  var dec_value = value.split("").reverse().reduce(function (carry, digit, index) {
    if (from_range.indexOf(digit) === -1) throw new Error("Invalid digit `"+digit+"` for base "+from_base+".");
    return carry += from_range.indexOf(digit) * (Math.pow(from_base, index));
  }, 0);

  var new_value = "";
  while (dec_value > 0) {
    new_value = to_range[dec_value % to_base] + new_value;
    dec_value = (dec_value - (dec_value % to_base)) / to_base;
  }
  return new_value || "0";
};

const stringifyResponse = (players, bullets) => {
  let str = "";

  str += players.reduce((str, player) => {
    str += "!";
    str += convertBase(Math.floor(player.x), 10, 64) + "=";
    str += convertBase(Math.floor(player.y), 10, 64) + "=";
    str += convertBase(Math.floor(player.id), 10, 64) + "=";
    str += ({
      "up": "u",
      "down": "d",
      "left": "l",
      "right": "r"
    })[player.direction];
    return str;
  }, "");

  str += bullets.reduce((str, bullet) => {
    str += "?";
    str += convertBase(Math.floor(bullet.x), 10, 64) + "=";
    str += convertBase(Math.floor(bullet.y), 10, 64);
    return str;
  }, "");

  return str;
};

// Broadcast to all.
wss.broadcast = function broadcast(...data) {
  wss.clients.forEach(function each(client) {
    if (client.readyState === WebSocket.OPEN) {
      if(!JSON.stringify(data).trim()) throw data;
      client.send(JSON.stringify(data));
    }
  });
};

let map;
let players;
let bullets;

mainEmitter.emit("ready");

mainEmitter.on("map", newMap => {
  map = newMap;
});

mainEmitter.on("players", newPlayers => players = newPlayers);
mainEmitter.on("bullets", newBullets => bullets = newBullets);

let tickCounter = 0;

mainEmitter.on("tick", () => {
  if(!players) return;

  if(tickCounter % tickSkip === 0){
    wss.clients.forEach(function each(client) {
      if (client.readyState === WebSocket.OPEN) {
        if(!JSON.stringify(stringifyResponse(players, bullets)).trim()) throw stringifyResponse(players, bullets);
        client.send(stringifyResponse(players, bullets));
      }
    });
    wss.broadcast({
      type: "tick",
      data: {
        players: players.map(player => ({
          x: player.x,
          y: player.y,
          width: player.width,
          height: player.height,
          direction: player.direction,
          fillColor: player.fillColor,
          id: player.id
        })),
        bullets: bullets.map(bullet => ({
          x: bullet.x,
          y: bullet.y,
          width: bullet.width,
          height: bullet.height,
          size: bullet.size,
          direction: bullet.direction,
          fillColor: bullet.fillColor
        }))
      }
    });
  }

  tickCounter ++;
});

wss.on("connection", function connection(ws) {
  const send = (...data) => {
    if(ws.readyState !== WebSocket.OPEN) return;
    if(!JSON.stringify(data).trim()) throw data;
    ws.send(JSON.stringify(data));
  };
  ws.on("message", function incoming(data) {
    try{
      JSON.parse(data).forEach(data => {
        try{
          switch(data.type){
          case "hello":
            ws.id = Math.floor(Math.random() * 32768);
            send({type: "map", data: map}, {type: "playerinfo", data: {
              id: ws.id
            }});
            mainEmitter.emit("newUser", ws.id);
            break;
          case "keyDown":
            if(["w", "a", "s", "d"].includes(data.data)){
              mainEmitter.emit("keyDown", {
                key: data.data,
                id: ws.id
              });
            }
            break;
          case "keyUp":
            if(["w", "a", "s", "d"].includes(data.data)){
              mainEmitter.emit("keyUp", {
                key: data.data,
                id: ws.id
              });
            }
            break;
          case "keyPress":
            if(data.data === "q"){
              mainEmitter.emit("keyPress", {
                key: data.data,
                id: ws.id
              });
            }
            break;
          default:
            throw new Error("Unknown WS protocol type", data.type);
          }
        }catch(err){
          console.error("Unexpected error in message processing", err);
        }
      });
    }catch(err){
      console.error("Unexpected error in JSON parsing", err);
    }
  });
  ws.on("close", () => {
    console.log("removing user", ws.id);
    mainEmitter.emit("removeUser", ws.id);
  });
  ws.on("error", err => console.error("ERROR", err));
});

// detect and close broken connections.
function noop() {}

function heartbeat() {
  this.isAlive = true;
}

wss.on("connection", function connection(ws) {
  ws.isAlive = true;
  ws.on("pong", heartbeat);
});

setInterval(function ping() {
  wss.clients.forEach(function each(ws) {
    if (ws.isAlive === false || ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED){
      console.log("Terminating", ws.id);
      if(ws.id) mainEmitter.emit("removeUser", ws.id);
      return ws.terminate();
    }

    ws.isAlive = false;
    ws.ping(noop);
  });
}, MAX_CONNECTION_BROKEN_WAIT);
