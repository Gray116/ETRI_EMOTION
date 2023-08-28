'use strict'

const createExample = require('../browser/example')
const localVideo = document.createElement('video');
localVideo.autoplay = true;
localVideo.muted = true;

const makeData = document.createElement('div');
makeData.className = 'grid_makeData';
document.body.appendChild(makeData);

let rece_agentID;
let rece_callID;

$(document).ready(function () {
    // 상담원 ID 값 받아 server에 Data Channel로 전달
    $.ajax({
        type: 'GET',
        url: '/callCenter/agent_id',
        async: false,
        dataType: 'json',
        error: function (error) {
            alert(`통신 실패\n${error}`);
        },
        success: function (result) {
            rece_agentID = result[0].agent_id;
            $('.inner_client').html("상담사 " + rece_agentID);
            console.log('상담사 ID: ' + rece_agentID);
        }
    });

    // call id 값 받아 Data Channel로 전달
    $('.startButton1').click(function () {
        $.ajax({
            url: '/restAPI/call_start',
            async: false,
            dataType: 'json',
            type: 'POST',
            data: { data: rece_callID },
            error: function (error) {
                alert(error);
            },
            success: function (result) {
                // 생성된 데이터의 callinfo_id(result.insertId)
                if (result) {
                    rece_callID = result[0].callinfo_id;
                    rece_agentID = 1;

                    console.log(`callinfo_id: ${rece_callID}\nagent_id: ${rece_agentID}`);
                } else {
                    alert('데이터 없음');
                }
            }
        });
    });
});

async function beforeAnswer(peerConnection) {
    let dataChannel = null;

    function onMessage({ data }) {
        if (data === 'Server received') {
            console.log('Server received message');
        }
    }

    function onDataChannel({ channel }) {
        if (channel.label !== 'agent_call_id') { return; }

        dataChannel = channel;
        console.log('상담사 ID: ' + rece_agentID);
        console.log('콜 ID: ' + rece_callID);
        dataChannel.send(`${rece_agentID}_${rece_callID}`);
        console.log(`서버에 ID(${rece_agentID}${rece_callID}) 전달 성공`);

        dataChannel.addEventListener('message', onMessage);
    }
    peerConnection.addEventListener('datachannel', onDataChannel);

    const localStream = await window.navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true
    });

    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    localVideo.srcObject = localStream;

    const { close } = peerConnection;
    peerConnection.close = function () {
        if (dataChannel) {
            dataChannel.removeEventListener('message', onMessage);
        }

        localVideo.srcObject = null;
        localStream.getTracks().forEach(track => track.stop());

        return close.apply(this, arguments);
    };
}

createExample({ beforeAnswer });