"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dgram_1 = require("dgram");
const get_port_1 = __importDefault(require("get-port"));
function getPayloadType(message) {
    return message.readUInt8(1) & 0x7f;
}
function isRtpMessage(message) {
    const payloadType = getPayloadType(message);
    return payloadType > 90 || payloadType === 0;
}
class RtpSplitter {
    constructor(serverPort, audioRTCPPort, returnAudioPort) {
        this.socket = dgram_1.createSocket('udp4');
        // emits when any error occurs
        const socket = this.socket;
        socket.on('error', (error) => {
            console.log('Error: ' + error);
            socket.close();
        });
        // emits on new datagram msg
        socket.on('message', (msg) => {
            if (isRtpMessage(msg)) {
                if (msg.length > 50) {
                    socket.send(msg, returnAudioPort, 'localhost');
                }
                else {
                    socket.send(msg, audioRTCPPort, 'localhost');
                }
            }
            else {
                socket.send(msg, audioRTCPPort, 'localhost');
                // Send RTCP to return audio as a heartbeat
                socket.send(msg, returnAudioPort, 'localhost');
            }
        });
        socket.bind(serverPort);
    }
    close() {
        this.socket.close();
    }
}
exports.RtpSplitter = RtpSplitter;
// Need to reserve ports in sequence because video uses the next port up by default.  If it's taken, video will error
async function reservePorts(count = 1) {
    const port = await get_port_1.default();
    const ports = [port];
    const tryAgain = () => {
        return reservePorts(count);
    };
    for (let i = 1; i < count; i++) {
        const targetConsecutivePort = port + i;
        // eslint-disable-next-line no-await-in-loop
        const openPort = await get_port_1.default({ port: targetConsecutivePort });
        if (openPort !== targetConsecutivePort) {
            // can't reserve next port, bail and get another set
            return tryAgain();
        }
        ports.push(openPort);
    }
    return ports;
}
exports.reservePorts = reservePorts;
//# sourceMappingURL=Util.js.map