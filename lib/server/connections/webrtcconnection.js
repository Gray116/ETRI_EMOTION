'use strict';

const DefaultRTCPeerConnection = require('wrtc').RTCPeerConnection;
const Connection = require('./connection');

const TIME_TO_CONNECTED = 10000;
const TIME_TO_HOST_CANDIDATES = 3000;
const TIME_TO_RECONNECTED = 10000;

class WebRtcConnection extends Connection {
  constructor(id, options = {}) {
    super(id);

    options = {
      RTCPeerConnection: DefaultRTCPeerConnection,
      beforeOffer() {},
      clearTimeout,
      setTimeout,
      timeToConnected: TIME_TO_CONNECTED,
      timeToHostCandidates: TIME_TO_HOST_CANDIDATES,
      timeToReconnected: TIME_TO_RECONNECTED,
      ...options
    };

    const {
      RTCPeerConnection,
      beforeOffer,
      timeToConnected,
      timeToReconnected
    } = options;

    const peerConnection = new RTCPeerConnection({
      sdpSemantics: 'unified-plan'
    });

    beforeOffer(peerConnection);
    
    let connectionTimer = options.setTimeout(() => {
      if (peerConnection.iceConnectionState !== 'connected' && peerConnection.iceConnectionState !== 'completed') {
        this.close();
      }
    }, timeToConnected);

    let reconnectionTimer = null;

    const onIceConnectionStateChange = () => {
      if (peerConnection.iceConnectionState === 'connected' || peerConnection.iceConnectionState === 'completed') {
        if (connectionTimer) {
          options.clearTimeout(connectionTimer);
          connectionTimer = null;
        }

        options.clearTimeout(reconnectionTimer);
        reconnectionTimer = null;
      } else if (peerConnection.iceConnectionState === 'disconnected' || peerConnection.iceConnectionState === 'failed') {
        if (!connectionTimer && !reconnectionTimer) {
          const self = this;
          reconnectionTimer = options.setTimeout(() => {
            self.close();
          }, timeToReconnected);
        }
      }
    };
    peerConnection.addEventListener('iceconnectionstatechange', onIceConnectionStateChange);

    this.doOffer = async () => {
      const offer = await peerConnection.createOffer();

      await peerConnection.setLocalDescription(offer);
      
      try {
        await waitUntilIceGatheringStateComplete(peerConnection, options);
      } catch (error) {
        this.close();
        logger.error(err);or;
      }
    };

    this.applyAnswer = async answer => {
      await peerConnection.setRemoteDescription(answer);
    };

    this.close = () => {
      peerConnection.removeEventListener('iceconnectionstatechange', onIceConnectionStateChange);
      if (connectionTimer) {
        options.clearTimeout(connectionTimer);
        connectionTimer = null;
      }

      if (reconnectionTimer) {
        options.clearTimeout(reconnectionTimer);
        reconnectionTimer = null;
      }

      peerConnection.close();
      super.close();
    };

    this.toJSON = () => {
      return {
        ...super.toJSON(),
        iceConnectionState: this.iceConnectionState,
        localDescription: this.localDescription,
        remoteDescription: this.remoteDescription,
        signalingState: this.signalingState
      };
    };

    Object.defineProperties(this, {
      iceConnectionState: {
        get() {
          return peerConnection.iceConnectionState;
        }
      },
      localDescription: {
        get() {
          return descriptionToJSON(peerConnection.localDescription, true);
        }
      },
      remoteDescription: {
        get() {
          return descriptionToJSON(peerConnection.remoteDescription);
        }
      },
      signalingState: {
        get() {
          return peerConnection.signalingState;
        }
      }
    });
  }
}

function descriptionToJSON(description, shouldDisableTrickleIce) {
  return !description ? {} : {
    type: description.type,
    sdp: shouldDisableTrickleIce ? disableTrickleIce(description.sdp) : description.sdp
  };
}

function disableTrickleIce(sdp) {
  return sdp.replace(/\r\na=ice-options:trickle/g, '');
}

async function waitUntilIceGatheringStateComplete(peerConnection, options) {  
  if (peerConnection.iceGatheringState === 'complete') {
    return;
  }

  const { timeToHostCandidates } = options;

  const deferred = {};
  deferred.promise = new Promise((resolve, reject) => {
    deferred.resolve = resolve;
    deferred.reject = reject;
  });

  const timeout = options.setTimeout(() => { // 타임아웃이면 이벤트리스너 삭제
    peerConnection.removeEventListener('icecandidate', onIceCandidate);
    deferred.reject(new Error('Timed out waiting for host candidates'));
  }, timeToHostCandidates);

  // candidate  : STUN, TURN 서버를 이용해 획득한 IP 주소와 프로토콜, 포트의 조합으로 구성된
  //              연결 가능한 네트워크 주소들을 지칭함

  // ICE        : Interactive Connectivity Establishment를 말하며, 두 개의 단말이 P2P 연결을
  //              가능하게 하도록 최적의 경로를 찾아주는 프레임워크
  //              STUN과 TURN을 활용하여 여러 Candidate를 검출하고 이들 중 하나를 선택하여
  //              Peer 간 연결을 수행한다.
  function onIceCandidate({ candidate }) {
    if (!candidate) {
      options.clearTimeout(timeout);
      peerConnection.removeEventListener('icecandidate', onIceCandidate);
      deferred.resolve();
    }
  }
  peerConnection.addEventListener('icecandidate', onIceCandidate);

  await deferred.promise;
}

module.exports = WebRtcConnection;