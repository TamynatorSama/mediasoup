import express from 'express';
import http from "httpolyglot";
import fs from 'fs';
import path from 'path';
import { Server } from 'socket.io'
import mediasoup from 'mediasoup'

const __dirname = path.resolve();
const app = express();

app.get('/', (req, res) => {
  res.send("hello from media soup")
});
app.use('/sfu', express.static(path.join(__dirname, "public")))

app.get("/test", (req, res) => {
  res.json({
    message: "success"
  })
})
const options = {};

const httpServer = http.createServer(options, app);
httpServer.listen(3000, () => {
  console.log("listening on port 3000");
});
const io = new Server(httpServer);
const peer = io.of('/mediasoup')


let worker;
let router
let producerTransport
let consumerTransport
let producer
let consumer


const createWorker = async () => {
  worker = await mediasoup.createWorker({
  })
  console.log(`worker pid ${worker.pid}`)
  worker.on('died', error => {
    console.error("mediasoup worker has died")
    setTimeout(() => process.exit, 2000)
    return worker
  })
  return worker;
}

worker = createWorker();

const mediaCodecs = [{
  kind: 'audio',
  mimeType: 'audio/opus',
  clockRate: 48000,
  channels: 2
}, {
  kind: 'video',
  mimeType: 'video/VP8',
  clockRate: 90000,
  channels: 2,
  parameters: {
    'x-google-start-bitrate': 1000,
  }
}]




peer.on('connection', async (socket) => {
  console.log(socket.id);
  socket.emit('connection-success', {
    socketId: socket.id
  })
  socket.on("disconnect", () => {
    console.log("client disconnected")
  })
  router = await worker.createRouter({ mediaCodecs });
  socket.on("getRtpCapabilities", (callback) => {
    const rtpCapabilities = router.rtpCapabilities
    console.log(rtpCapabilities);
    callback({ rtpCapabilities })
  })

  socket.on('createWebRtcTransport', async ({ sender }, callback) => {
    console.log(`is this a sender request? ${sender}`)

    if (sender) {
      producerTransport = await createWebRtcTransportRequest(callback);
    } else {
      consumerTransport = await createWebRtcTransportRequest(callback);
    }
  })

  // see client's socket.emit('transport-connect', ...)
  socket.on('transport-connect', async ({ dtlsParameters }) => {
    console.log('DTLS PARAMS... ', { dtlsParameters })
    await producerTransport.connect({ dtlsParameters })
  })

  // see client's socket.emit('transport-produce', ...)
  socket.on('transport-produce', async ({ kind, rtpParameters, appData }, callback) => {
    // call produce based on the prameters from the client

    producer = await producerTransport.produce({
      kind,
      rtpParameters,
    })

    console.log('Producer ID: ', producer.id, producer.kind)

    producer.on('transportclose', () => {
      console.log('transport for this producer closed ')
      producer.close()
    })

    // Send back to the client the Producer's id
    callback({
      id: producer.id
    })
  })

  // see client's socket.emit('transport-recv-connect', ...)
  socket.on('transport-recv-connect', async ({ dtlsParameters }) => {
    console.log(`DTLS PARAMS: ${dtlsParameters}`)
    await consumerTransport.connect({ dtlsParameters })
  })

  socket.on('consume', async ({ rtpCapabilities }, callback) => {
    console.log("set consume event")
    try {

      // check if the router can consume the specified producer
      
      if (router.canConsume({
        producerId: producer.id,
        rtpCapabilities
      })) {
        // transport can now consume and return a consumer
        consumer = await consumerTransport.consume({
          producerId: producer.id,
          rtpCapabilities,
          paused: true,
        })

        console.log(consumer);


        consumer.on('transportclose', () => {
          console.log('transport close from consumer')
        })

        consumer.on('producerclose', () => {
          console.log('producer of consumer closed')
        })

       

        // from the consumer extract the following params
        
        const params = {
          id: consumer.id,
          producerId: producer.id,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        }

        // send the parameters to the client
        callback({ params })
      }
    } catch (error) {
      console.log(error.message)
      console.log("herererasadsda")
      callback({
        params: {
          error: error
        }
      })
    }
  })

  socket.on('consumer-resume', async () => {
    console.log('consumer resume')
    await consumer.resume()
  })

})

const createWebRtcTransportRequest = async (callback) => {
  try {
    const webRtcTransport_options = {
      listenIps: [
        {
          ip: "127.0.0.1"
        }
      ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true
    }

    let transport = await router.createWebRtcTransport(webRtcTransport_options)
    transport.on('dtlsstatechange', dtlsState => {
      if (dtlsState === "closed") {
        transport.close();
      }
    })




    transport.on('close', () => {
      console.log("transport closed")
    })

    callback({
      params: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters

      }
    })
    return transport
  } catch (error) {
    console.log("here")
    console.error(error);
    callback({
      params: {
        error: error
      }
    })
  }
}