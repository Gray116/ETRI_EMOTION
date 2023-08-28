'use strict';

const createStartStopButton = require('./startstopbutton');
const ConnectionClient = require('../client');

function createExample(options) {
  const connectionClient = new ConnectionClient();

  let peerConnection = null;

  createStartStopButton(async () => {
    peerConnection = await connectionClient.createConnection(options);
    window.peerConnection = peerConnection;
  }, () => {
    peerConnection.close();
  });
}

module.exports = createExample;