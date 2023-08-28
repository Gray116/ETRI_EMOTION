'use strict'

const logger                          = require('/home/test/ETRI/230714_ETRI/logs/logger');
const dgram                           = require('dgram');
const server                          = dgram.createSocket('udp6'); // udp6 : UDP over IPv6
const serverIp                        = '211.41.186.209';
const serverPt                        = 5555; // 포트는 정해야 함

const { PassThrough }                 = require('stream');
const fs                              = require('fs');
const cron                            = require('node-cron');
const mysql                           = require('mysql');
const net                             = require('net'); // TCP통신을 하기 위한 모듈

const { RTCAudioSink, RTCVideoSink }  = require('wrtc').nonstandard;
const ffmpegPath                      = require('@ffmpeg-installer/ffmpeg').path;
const { StreamInput }                 = require('fluent-ffmpeg-multistream');
const ffmpeg                          = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(ffmpegPath);

const Parser                          = require('binary-parser').Parser;
const Enum                            = require('enum');
const sleep                           = require('sleep');
const amqp                            = require('amqplib/callback_api');

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// 2. 외부 연동 메세지 타입 정의
const ExternalMsgType_e = new Enum({
    'ErkServiceConnRQ': 0,
    'ErkServiceConnRp': 1,
    'ErkServiceDisConnRQ': 2,
    'ErkServiceDisConnRP': 3,
    'AddServiceProviderInfoRQ': 4,
    'AddServiceProviderInfoRP': 5,
    'DelServiceProviderInfoRQ': 6,
    'DelServiceProviderInfoRP': 7,
    'UpdServiceProviderInfoRQ': 8,
    'UpdServiceProviderInfoRP': 9,
    'AddUserInfoRQ': 10,
    'AddUserInfoRP': 11,
    'DelUserInfoRQ': 12,
    'DelUserInfoRP': 13,
    'UpdUserInfoRQ': 14,
    'UpdUserInfoRP': 15,
    'PhysioEmoREcogRQ': 16,
    'SpeechEmoRecogRQ': 17,
    'FaceEmoRecogRQ': 18,
    'EmoRecogRQ': 19,
    'EmoRecogRP': 20,
    'reserved1': 21,
    'reserved2': 22
});

// 2.1. 감성 상태 정의
const EmotionType_e = new Enum({
    "neutral": 0,
    "positive": 1,
    "negative": 2,
    "stress": 3,
    "joy": 4,
    "happy": 5,
    "sadness": 6,
    "anger": 7,
    "arousal": 8,
    "relaxation": 9,
    "peace": 10,
    "anxiety": 11,
    "fear": 12,
    "disgust": 13,
    "etc": 14
});

// 2.2 결과정보 코드 정의
const ReturnCode_e = new Enum({
    "ok": 0,
    "nok_Org": 1,
    "nok_Usr": 2,
    "nok_MsgType": 3,
    "nok_EngineType": 4,
    "nok_EngineCondition": 5,
    "nok_DevPlatform": 6,
    "nok_EmotionType": 7,
    "nok_reason1": 8,
    "nok_reason2": 9,
});

// 2.3 접속 단말 구분 정의
const Platform_e = new Enum({
    "Android": 0,
    "IOS": 1,
    "Windows": 2,
    "etc": 3
});

// 2.4 엔진 상태 정의
const EngineCondition_e = new Enum({
    "available": 0,
    "not_available": 1
});

// 2.5 엔진 타입 정의
const EngineType_e = new Enum({
    "physiology": 0,
    "speech": 1,
    "face": 2,
    "emo_recog_all": 3,
    "knowledge": 4,
    "reserved1": 5,
    "reserved2": 6
});

// 2.6 감성인지 서비스 타입 정의
const ServiceType_e = new Enum({
    'physiology': 0,
    'speech': 1,
    'face': 2,
    'physiology_speech': 3,
    'physiology_speech_face': 4,
    'knowledge': 5,
    'service_all': 6,
    'reserved1': 7,
    'reserved2': 8,
});

// 2.7 [사업자 프로파일링] 메세지 처리 결과 정보
const OrgProfileResult_e = new Enum({
    'ok': 0,
    'nok_OrgName': 1,
    'nok_OrgPwd': 2,
    'nok_ServiceDuration': 3,
    'nok_UserNumber': 4,
    'nok_ServiceType': 5,
    'nok_DB': 6,
    'nok_reason1': 7,
    'nok_reason2': 8
});

// 2.8 [사용자 프로파일링] 메세지 처리 결과 정보
const UserProfileResult_e = new Enum({
    'ok': 0,
    'nok': 1,
    'nok_OrgName': 2,
    'nok_UserName': 3,
    'nok_UserPwd': 4,
    'nok_ServiceDuration': 5,
    'nok_Age': 6,
    'nok_Sex': 7,
    'nok_UserType': 8,
    'nok_ServiceType': 9,
    'nok_DB': 10,
    'nok_reason1': 11,
    'nok_reason2': 12
});

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// 3. Header 정의
const ErkMsgHeader = new Parser()
    .endianness("big")          // [big endianness]
    .uint8("MsgType")           // [메세지 타입]                                                  - 8비트(16진수 2자리, 1바이트) 0x00
    .uint16("OrgId")            // [상담원 소속 기관정보 ID(기관별 ID부여)]                       - 16비트(16진수 4자리, 2바이트) 
    .uint32("UserId")           // [ETRI에서 보내준 USER ID]                                      - 32비트(16진수 8자리, 4바이트) 
    .uint32("MsgTimeStamp")     // [월일 + 시퀀스(6자리) 최대 4294967295까지 표현 가능]           - 32비트(16진수 8자리, 4바이트) 
    .uint8("DevPlatform")       // [접속 단말 구분 ID {00:안드로이드, 01:IOS, 02:Windows}]        - 8비트(16진수 2자리, 1바이트) 

// 4. 음성감성인지 요구 메세지 정의 (전송주기 1초)
const SpeechEmoRecogRQ_m = new Parser()
    .endianness("big")          // [big endianness]
    .uint8("MsgType")           // [메세지 타입]                                                  - 8비트(16진수 2자리, 1바이트) 
    .uint16("OrgId")            // [상담원 소속 기관정보 ID(기관별 ID부여: 13516{네이버시스템})]  - 16비트(16진수 4자리, 2바이트) 
    .uint32("UserId")           // [ETRI에서 보내준 USER ID]                                      - 32비트(16진수 8자리, 4바이트) 
    .uint32("MsgTimeStamp")     // [월일 + 시퀀스(6자리)]                                         - 32비트(16진수 8자리, 4바이트)
    .uint8("DevPlatform")       // [접속 단말 구분 ID {00:안드로이드, 01:IOS, 02:Windows}]        - 8비트(16진수 2자리, 1바이트) 
    .uint32("DataTimeStamp")    // [메세지 전송할 당시 시간(감성인지 요청시간)]                   - 32비트(16진수 4자리, 4바이트) 
    .uint16("MsgDataLengh")     // [전송 될 원래 데이터 크기]                                     - 16비트(16진수 4자리, 2바이트) 
    .int16("MsgDataFrame")      // [1초 Raw PCM(wav), 44.1khz]                                    - 16비트(16진수 4자리, 2바이트) 3초 기준 266,274바이트, 헤더(44바이트) 제거 후 266,230바이트), 41,000바이트씩 전송

// 5. 감성인지결과 리턴 메세지 포맷
const EmoRecogRP_m = new Parser()
    .endianness("big")          // [big endianness]
    .uint8("MsgType")           // [메세지 타입]                                                  - 8비트(16진수 2자리, 1바이트)
    .uint16("OrgId")            // [상담원 소속 기관정보 ID(기관별 ID부여: 13516{네이버시스템})]  - 16비트(16진수 4자리, 2바이트)  
    .uint32("UserId")           // [ETRI에서 보내준 USER ID]                                      - 32비트(16진수 8자리, 4바이트) 
    .uint32("MsgTimeStamp")     // [월일 + 시퀀스(6자리)]                                         - 32비트(16진수 8자리, 4바이트)
    .uint8("DevPlatform")       // [접속 단말 구분 ID {00:안드로이드, 01:IOS, 02:Windows}]        - 8비트(16진수 2자리, 1바이트)
    .int8("ReturnCode")         // [결과정보 코드]                                                - 8비트(16진수 1자리, 1바이트)
    .uint32("EmoRecogTime")     // [감성인지 시간(데이터 분석 완료 당시 시간)]                    - 32비트(16진수 8자리, 4바이트)
    .int8("Emotion")            // [감정 종류]                                                    - 8비트(16진수 1자리, 1바이트)
    .floatle("Accuracy")        // [감정 정확도(%)]                                               - 32비트(16진수 8자리, 4바이트)

// 6. 상담사(서비스) 인증 리턴 메세지 포맷
const ErkServiceConnRP_m = new Parser()
    .endianness("big")          // [big endianness]
    .uint8("MsgType")           // [메세지 타입]                                                  - 8비트(16진수 2자리, 1바이트)
    .uint16("OrgId")            // [상담원 소속 기관정보 ID(기관별 ID부여: 13516{네이버시스템})]  - 16비트(16진수 4자리, 2바이트) 
    .uint32("UserId")           // [상담원 ID → 월일, 상담사ID, 파일시퀀스]                       - 32비트(16진수 8자리, 4바이트)
    .uint32("MsgTimeStamp")     // [실시간 41000바이트 녹취 시작 시간]                            - 32비트(16진수 8자리, 4바이트)
    .uint8("DevPlatform")       // [접속 단말 구분 ID {00:안드로이드, 01:IOS, 02:Windows}]        - 8비트(16진수 2자리, 1바이트)
    .uint8("ReturnCode")        // [결과정보 코드]                                                - 8비트(16진수 1자리, 1바이트)
    .uint8("EngineType")        // [음성 감정 엔진 타입]                                          - 8비트(1바이트)
    .uint8("EngineCondition")   // [음성 감정 엔진 상태]                                          - 8비트(1바이트)
    .uint8("IpAddr1")           // [음성 엔진 접속 IP주소]                                        - 8비트(1바이트)
    .uint8("IpAddr2")           // [음성 엔진 접속 IP주소]                                        - 8비트(1바이트)
    .uint8("IpAddr3")           // [음성 엔진 접속 IP주소]                                        - 8비트(1바이트)
    .uint8("IpAddr4")           // [음성 엔진 접속 IP주소]                                        - 8비트(1바이트)
    .uint16("PortNumber")       // [포트 번호]                                                    - 16비트(2바이트)

// 7. 사업자 프로파일링 등록 요청 메세지
const AddServiceProviderInfoRQ_m = new Parser()
    .endianness("big")          // [big endianness]
    .string("OrgName", {        // [서비스 사업자 정보: 기관명]                                   - 배열 16자리
        zeroTerminated: true,
        length: 16
    })
    .string("OrgPwd", {         // [서비스 사업자 비밀번호]                                       - 배열 16자리
        zeroTerminated: true,
        length: 16
    })
    .uint32("ServiceDuration")  // [서비스 계약 기간]                                             - 32비트(16진수 8자리, 4바이트) 0x00 0x00 0x00 0x00 0x00 0x00 0x00 0x00 ~ 
    .uint16("UserNumber")       // [서비스 이용인원 (이용자 수)]                                  - 16비트(16진수 4자리, 2바이트)
    .uint8("ServiceType")       // [감성인지엔진 서비스 사용 종류]                                - 16비트(16진수 4자리, 2바이트)

// 7.1 사업자 프로파일링 등록 요청 결과 메세지
const AddServiceProviderInfoRP_m = new Parser()
    .endianness("big")           // [big endianness]
    .string("OrgName", {         // [서비스 사업자 정보: 기관명]                                   - 배열 16자리
        zeroTerminated: true,
        length: 16
    })
    .uint8("ResultType")         // [처리 결과]                                                    - 8비트(16진수 2자리, 1바이트)
    .uint16("OrgId")             // [사업자 ID]                                                    - 16비트(16진수 4자리, 2바이트)

// 8. 상담사(사용자) 프로파일링 등록 요청 메세지
const AddUserInfoRQ_m = new Parser()
    .endianness("big")          // [big endianness]
    .string("OrgName", {
        zeroTerminated: true,
        length: 16
    })                          // [서비스 사업자 정보: 기관명]                                   - 배열 16자리
    .string("UserName", {       // [사용자 이름]
        zeroTerminated: true,
        length: 16
    })
    .string("UserPwd", {        // [사용자 비밀번호]
        zeroTerminated: true,
        length: 16
    })
    .uint32("ServiceDuration")  // [서비스 계약 기간]                                             - 32비트(16진수 8자리, 4바이트)
    .string("Age", {            // [나이]                                                         - 배열 16자리
        zeroTerminated: true,
        length: 1
    })
    .string("Sex", {            // [성별]
        zeroTerminated: true,
        length: 1
    })
    .string("UserType", {       // [관리대상(특이사항 분류) 추후 정의]
        zeroTerminated: true,
        length: 1
    })
    .uint8("ServiceType")       // [감성인지엔진 서비스 사용 종류]                                - 8비트(16진수 2자리, 1바이트)

// 8.1 상담사(사용자) 프로파일링 등록 요청 결과 메세지
const AddUserInfoRP_m = new Parser()
    .endianness("big")          // [big endianness]
    .string("OrgName", {        // [서비스 사업자: 기관명]                                        - 배열 16자리
        zeroTerminated: true,
        length: 16
    })
    .string("UserName", {       // [사용자 이름]
        zeroTerminated: true,
        length: 16
    })
    .uint32("UserId")           // [사용자 ID]                                                    - 32비트(16진수 8자리, 4바이트)
    .uint8("ResultType")        // [처리 결과]                                                    - 8비트(16진수 2자리, 1바이트)

// 헤더 부
let MsgType = ExternalMsgType_e.SpeechEmoRecogRQ.value;
let userId;
let ErkMsgHead_t;

// 데이터 부
// new ArrayBuffer(n): n바이트의 메모리를 확보하고 바이너리 데이터를 0으로 채움
let MsgDataLength;
let MsgDataFrame_arrbuff = new ArrayBuffer(41000);
let MsgDataFrame = new Uint16Array(MsgDataFrame_arrbuff);

// 파일 길이 체크
let content;
let contentLength;

// 기타 변수
let callId;
let agentId;
let callTime;
let fileSeqNo = 0;
let numSlice;

// erkconn_return_ipAddr
let speakingIp;

//////////////////////////////////  녹취 및 분할  //////////////////////////////////////////////
// 1. peer connection을 통한 음성 녹음 (3초 대략 266,000kb)
function beforeOffer(peerConnection) {
  const dataChannel = peerConnection.createDataChannel('agent_call_id');
  const audioTransceiver = peerConnection.addTransceiver('audio');
  const videoTransceiver = peerConnection.addTransceiver('video');
  const audioSink = new RTCAudioSink(audioTransceiver.receiver.track);
  const videoSink = new RTCVideoSink(videoTransceiver.receiver.track);

  function onMessage({ data }) {
    if (data) {
      dataChannel.send('Server received!');
      logger.info(`[클라이언트로부터 받은 CALL 정보] - ${data}]`);

      // [agent_id]_[call_id]로 넘어옴
      mdata = data.substring(0, data.indexOf('_')).padStart(2, '0');
      mdata2 = data.substring(data.indexOf('_') + 1);

      logger.info(`[ 클라이언트로부터 받은 상담사 ID  : ${mdata} ]`);
      logger.info(`[ 클라이언트로부터 받은 콜 ID      : ${mdata2} ]`);
    }
  }
  dataChannel.addEventListener('message', onMessage);

  let mdata = null;  // USER ID값(string) 받아옴
  let mdata2 = null;  // CALL ID값 받아옴

  const task = cron.schedule('*/1 * * * * *', function () {
    // 파일리스트는 배열의 형태로 반환됨
    fs.readdir('./1_recordings/', (err, fileList) => {
      if (err) { logger.error(err); }
      let newList = [];

      fileList.map((item, index) => {
        if (item.toString().indexOf(mdata) > -1) {
          newList.push(item);
        }
      });

      // 배열에 파일이 2개 이상이면 첫번째 파일을 바로 recorded로 이동
      if (newList.length >= 2) {
        try {
          fs.rename(`./1_recordings/${newList[0]}`, `./2_recorded/${newList[0]}`, function (err) {
            if (err) { logger.error(err); }
          });
        } catch (err) { logger.error(err); }
      } else {
        logger.info('녹취 중 또는 디렉토리에 파일 없음');
      }
    });
  }, { scheduled: false });

  let streams = [];
  videoSink.addEventListener('frame', ({ frame: { width, height, data } }) => {
    const size = width + 'x' + height;
    if (!streams[0] || (streams[0] && streams[0].size !== size)) {
      const stream = {
        size,
        video: new PassThrough(),
        audio: new PassThrough()
      };

      // stream 중이면 오디오 버퍼 push
      const onAudioData = ({ samples: { buffer } }) => {
        if (!stream.end) { stream.audio.push(Buffer.from(buffer)); }
      };
      audioSink.addEventListener('data', onAudioData);

      // stream이 끝나면 이벤트리스너 제거
      stream.audio.on('end', () => {
        audioSink.removeEventListener('data', onAudioData);
      });

      streams.unshift(stream);
      streams.forEach(item => {
        if (item !== stream && !item.end) {
          item.end = true;
          if (item.audio) { item.audio.end(); }
          item.video.end();
        }
      })

      stream.proc = ffmpeg()
        .addInput((new StreamInput(stream.audio)).url)
        .addInputOptions([
          '-f s16le',   // s16le: PCM, signed 16-bit, little-endian
          '-ar 44.1k',  // 오디오 샘플링 설정 ( 프레임 44100 )
          '-ac 1',      // 오디오 채널 설정 (1 = 모노, 2 = 스테레오)
        ])
        .addOutputOption([
          '-strftime', '1',            // location time 사용(default = 0): 날짜 형식 사용가능
          '-f', 'segment',             // output format: segment
          '-segment_time', '00:00:03', // 3초마다 세그먼트 단위를 분리
        ])
        .output(`1_recordings/%y%m%d%H%M%S_${mdata}_${mdata2}.wav`) // 파일 포맷: 년월일시분초_상담원ID_콜ID.wav
        .on('start', () => {
          task.start();
        })
        .on('end', () => {
          stream.recordEnd = true;

          // mdata(agent_id), mdata2(call_id)와 같은 call history만 recorded로 이동
          fs.readdirSync('./1_recordings/').forEach(file => {
            if (file.includes(mdata) && file.includes(mdata2) == true) {
              try {
                fs.rename(`./1_recordings/${file}`, `./2_recorded/${file}`, function (err) {
                  if (err) { logger.error(err); }
                });
                logger.info('해당 파일 이동 성공!');
              } catch (err) { logger.error(err); }
            }
          });
        })
        .on('error', (err) => { logger.error(err); });

      stream.proc.run();
    }
  });

  const { close } = peerConnection;
  peerConnection.close = function () {
    dataChannel.removeEventListener('message', onMessage);
    audioSink.stop();
    videoSink.stop();

    streams.forEach(({ audio, video, end, proc, recordPath }) => {
      if (!end) {
        if (audio) {
          audio.end();
        }
        video.end();
      }
    });

    return close.apply(this, arguments);
  }
}

// 2. 1초마다 2_recorded 디렉토리의 파일 41000바이트씩 분할 저장
cron.schedule('*/1 * * * * *', function () {
  // 사업자 ID 부여 받았는지 체크
  let return_orgId = `SELECT org_id
                      FROM emo_provider_info
                      WHERE org_name = 'neighbor system';`;

  connection.query(return_orgId, function (err, result) {
    if (err) {
      logger.error(err);
      connection.end();
    }
    logger.info(`[사업자 등록 여부]: ${JSON.stringify(result)}`);
    speakingIp = result[0].org_id;
  });

  if (speakingIp != null) {
    fs.readdir("./2_recorded/", (err, fileList) => {
      if (err) { logger.error(err); }
      if (fs.existsSync(`./2_recorded/${fileList[0]}`) == true) {
        logger.info(`[2_RECORDED] ${fileList[0]} 파일을 읽음`);

        // .wav 파일 헤더 제거
        let sliceContent = fs.readFileSync(`./2_recorded/${fileList[0]}`);
        sliceContent = sliceContent.subarray(44);

        // 상담사 id
        let fileInfo_id = fileList[0].substring(fileList[0].indexOf('_') + 1, 15);

        // 각 파일 크기
        let fileInfo_size;

        let i;
        let j = 0;

        let fileInfo_sql = `SELECT IFNULL(MAX(file_seq), 0) + 1 AS file_seq
                            FROM emo_file_info 
                            WHERE DATE(file_save_dt) = DATE_FORMAT(NOW(3),'%Y%m%d');`;

        fs.unlink(`./2_recorded/${fileList[0]}`, (err) => {
          if (err) { logger.error(err); }
          logger.info(`[${fileList[0]} 파일] 삭제`);

          connection.query(fileInfo_sql, function (err, result) {
            if (err) {
              connection.end();
              logger.error(err);
            }
            logger.info('[FILEINFO_SQL 성공 결과]\n' + fileInfo_sql);

            fileSeqNo = Number((result[0].file_seq).toString().padStart(6, '0'));
            logger.info(`시퀀스 번호 [${fileSeqNo}]`);

            // 파일의 크기가 41000바이트 초과면 분할 프로세스 진행 아니면 그냥 파일 이름만 변경
            if (sliceContent.byteLength > 41000) {
              // 저장할 횟수 (대략 266,274바이트: 6번 * 41000바이트 + 1번 * 나머지 바이트)
              logger.info(`파일의 크기는 ${sliceContent.byteLength}바이트입니다.`);

              for (i = 1; i <= parseInt(sliceContent.byteLength / 41000) + 1; i++) {
                let arrayBuffer = sliceContent;
                let lastArrayBuffer = sliceContent;

                try {
                  if (i != parseInt(sliceContent.byteLength) + 1) {
                    // 41000씩 subarray
                    arrayBuffer = sliceContent.subarray(j, j + 41000);
                    logger.info(arrayBuffer);
                    logger.info(`* ARRAYBUFFER 크기 * : ${arrayBuffer.byteLength}`);

                    // [월일(4자리) + 콜 시퀀스(4자리) + 상담사 ID(2자리)]_[년월일시분초]_[상담사id]_[call_id]_[자른파일 시퀀스] = 헤더에는 앞 10자리만
                    fs.writeFileSync('./3_sliced_records/' +
                      `${fileList[0].substring(2, 6)}${((fileSeqNo + i - 1).toString()).padStart(5, '0')}${i}_` + // 월일 + 시퀀스 + 분할 횟수
                      `${fileList[0].substring(0, fileList[0].indexOf('_'))}_` + // 년월일시분초_
                      `${fileList[0].substring(fileList[0].indexOf('_') + 1, 15).padStart(2, '0')}` + // 상담사id_
                      `${fileList[0].substring(fileList[0].lastIndexOf('_'), fileList[0].indexOf('.wav'))}_${i}.wav`, arrayBuffer); // callid_seq

                    j += 41000;

                    fileInfo_size = arrayBuffer.byteLength;
                  } else {
                    // 마지막 남은 바이트 저장
                    lastArrayBuffer = lastArrayBuffer.subarray(sliceContent.byteLength - (sliceContent.byteLength % 41000), sliceContent.byteLength);
                    logger.info(`마지막 ARRAYBUFFER SIZE: ${lastArrayBuffer.byteLength}`);

                    fs.writeFileSync('./3_sliced_records/' +
                      `${fileList[0].substring(2, 6)}${(fileSeqNo + i - 1).toString().padStart(5, '0')}${i}_` + // 월일(4자리) + 시퀀스(5자리) + 분할 횟수(1자리)
                      `${fileList[0].substring(0, fileList[0].indexOf('_'))}_` + // 년월일시분초_
                      `${fileList[0].substring(fileList[0].indexOf('_') + 1, 15).padStart(2, '0')}` + // 상담사id_
                      `${fileList[0].substring(fileList[0].lastIndexOf('_'), fileList[0].indexOf('.wav'))}_${i}.wav`, lastArrayBuffer); // callid_seq

                    fileInfo_size = lastArrayBuffer.byteLength;
                  }

                  // 상담사 call id 15자리
                  let fileInfo_callid = fileList[0].substring(16, 31);
                  // 파일 생성 시간
                  let fileInfo_date = fileList[0].substring(0, 12);
                  // 파일명 (월일(4) + 시퀀스(5) + 분할횟수(1))
                  let fileInfo_name = fileList[0].substring(2, 6) + ((fileSeqNo + i) - 1).toString().padStart(5, '0') + i;

                  // INSERT 문
                  let fileInfo_insert_sql = `INSERT INTO emo_file_info (emo_file_info_seq,callinfo_id, file_name, agent_id, file_slice_cnt, file_seq, file_size, file_save_dt, insert_dt)
                                            VALUES (NOW(3),'${fileInfo_callid}', '${fileInfo_name}', '${fileInfo_id}', ${i}, ${(fileSeqNo + i - 1)}, '${fileInfo_size}', STR_TO_DATE('${fileInfo_date}', '%y%m%d%H%i%s%f'), NOW(3))`;

                  connection.query(fileInfo_insert_sql, function (err, results) {
                    if (err) {
                      connection.end();
                      logger.error(err);
                    }

                    logger.info('[FILEINFO_INSERT_SQL 성공 결과]\n' + fileInfo_insert_sql);
                  });
                } catch (err) { logger.error(err); }
              }
            } else {
              // 나머지 남는 바이트에 대한 처리
              logger.info(`이 파일의 크기는 ${sliceContent.byteLength}바이트.`);

              fs.writeFileSync('./3_sliced_records/' +
                `${fileList[0].substring(2, 6)}${(fileSeqNo).toString().padStart(5, '0')}${'1'}_` + // 월일 + 시퀀스 + 분할횟수
                `${fileList[0].substring(0, fileList[0].indexOf('_'))}_` + // 년월일시분초_
                `${fileList[0].substring(fileList[0].indexOf('_') + 1, 15).padStart(2, '0')}` + // 상담사id_
                `${fileList[0].substring(fileList[0].lastIndexOf('_'), fileList[0].indexOf('.wav'))}_1.wav`, sliceContent); // callid_seq.wav

              // 파일의 크기
              fileInfo_size = sliceContent.byteLength;
              // 상담사 call id 15자리
              let fileInfo_callid = fileList[0].substring(16, 31);
              // 파일 생성 시간
              let fileInfo_date = fileList[0].substring(0, 12);
              // 파일명 (월일 + 시퀀스 + 상담사 id)
              let fileInfo_name = fileList[0].substring(2, 6) + (fileSeqNo).toString().padStart(5, '0') + '1';

              // INSERT 문
              let fileInfo_insert_sql = `INSERT INTO emo_file_info (emo_file_info_seq ,callinfo_id, file_name, agent_id, file_slice_cnt, file_seq,  file_size, file_save_dt, insert_dt)
                                        VALUES (NOW(3),'${fileInfo_callid}', '${fileInfo_name}', '${fileInfo_id}', 1, ${fileSeqNo}, '${fileInfo_size}', STR_TO_DATE('${fileInfo_date}', '%y%m%d%H%i%s%f'), NOW(3))`;

              connection.query(fileInfo_insert_sql, function (err, results) {
                if (err) {
                  connection.end();
                  logger.error(err);
                }

                logger.info('[FILEINFO_INSERT_SQL 성공 결과]\n' + fileInfo_insert_sql);
              });
            }
          });
        });
      } else { logger.info('2_RECORDED 디렉토리 파일 없음'); }
    });
  } else {
    logger.info('NO SERVICE AUTHENTICATED!');
  };
});

// 3. TCP 메세지 전송 (비동기 함수는 세미콜론 필수)
function tcpMessage(contentLength, userId, agentId, callId, numSlice) {
  // 1. QUERYING FOR TCP Header + DataTimeStamp ( 파일리스트의 가장 오래된 파일의 userId와 같은 데이터 조회 )
  let search_sql = `SELECT
                    CONCAT( LPAD(CONV(${MsgType}, 10, 16), 2, '0'),
                      LPAD(CONV(b.org_id, 10, 16), 4, '0'),
                      LPAD(CONV(a.userinfo_userId, 10, 16), 8, '0'),
                      LPAD(CONV(LEFT(${userId}, 10), 10, 16), 8, '0'),
                      LPAD(CONV(a.dev_platform, 10, 16), 2, '0'),
                      LPAD(CONV(LEFT(DATE_FORMAT(NOW(3), '%H%i%S%f'), 9), 10, 16), 8, '0')
                      ) AS tcpheader
                    FROM emo_agent_info a
                    LEFT OUTER JOIN emo_provider_info b
                      ON a.org_name = b.org_name
                    WHERE a.agent_id = ${Number(agentId)} 
                    LIMIT 1;`;
  
  try {
    // 1 STORING RESULTS ( 헤더에 데이터 담기 )
    connection.query(search_sql, function (err, result) {
      if (err) {
        connection.end();
        logger.error(err);
      }
      logger.info(`[SEARCH_SQL 쿼리 결과]\n${search_sql}`);
      logger.info(`[SEARCH_SQL 성공 결과] : ${JSON.stringify(result)}`);

      ErkMsgHead_t = JSON.stringify(result[0].tcpheader).substring(1, 33);

      // BINARY CONVERSION + CONCAT BUFFERS
      let arrayBuffer = Buffer.from(ErkMsgHead_t, 'hex');
      logger.info(`***************************************************`);
      logger.info(`ErkMsgHead       : ${ErkMsgHead_t}`);
      logger.info(`ErkMsgHead 길이  : ${ErkMsgHead_t.length}`);
      logger.info(`***************************************************\n`);

      // DataFrame 및 contentLength 값 나누기
      MsgDataLength = Buffer.from(contentLength.toString(16), 'hex');
      logger.info(`***************************************************`);
      logger.info(`MsgDataLength       : ${contentLength.toString(16)}`);
      logger.info(`MsgDataLength 길이  : ${MsgDataLength.byteLength}`);
      logger.info(`***************************************************\n`);

      // byteLength가 41000미만이면 새로운 arrabuffer에 추가
      if (contentLength < 41000) {
        logger.info('크기가 41000바이트보다 작아 새로운 버퍼에 입력');
        logger.info(`CONTENT 길이 : ${content.length}바이트(${typeof (content.length)})`);

        for (let j = 0; j < 41000; j++) {
          // 해당 파일의 길이보다 작을 때까지는 각 배열에 데이터 넣기
          if (j < contentLength) {
            MsgDataFrame[j] = Number(content[j]).toString(16).padStart(2, '0');
          } else {
            // contentlength를 넘어가게 되면 나머지 프레임은 전부 0으로 채움
            MsgDataFrame[j] = (0).toString(16).padStart(2, '0');
          }
        }

        logger.info(`********************************`);
        logger.info('[새로 채운 MsgDataFrame]');
        logger.info(MsgDataFrame.slice(60, 100));
        logger.info('[뒷 부분 0 채워졌는지 확인]');
        logger.info(MsgDataFrame.slice(-30));
        logger.info(`********************************\n`);

        logger.info(`******************************************`);
        logger.info(`파일의 원래 길이               : ${contentLength}`);
        logger.info(`전처리 후 MsgDataFrame의 길이  : ${MsgDataFrame.length}`);
        logger.info(`******************************************\n`);
      } else {
        // contentlength(본 파일의 길이)가 41000일 때는 그냥 버퍼에 담기
        MsgDataFrame = Buffer.from(content, 'hex');
        logger.info(`***********************************`);
        logger.info(`본 파일의 길이가 원래 41000바이트`);
        logger.info(`MsgDataFrame 길이 : ${MsgDataFrame.byteLength}`);
        logger.info(`***********************************\n`);
      }

      logger.info(`****************************************************************************`);
      logger.info(`ErkMsgHead_t(${arrayBuffer.byteLength}바이트) + MsgDataLength(${MsgDataLength.byteLength}바이트) + MsgDataFrame(${MsgDataFrame.byteLength})바이트`);
      logger.info(`본래 보내는 데이터의 크기(${contentLength}바이트)`);
      logger.info(`****************************************************************************\n`);

      // 버퍼 합치기
      let SpeechEmoRecogRQ_m_req = Buffer.concat([arrayBuffer, MsgDataLength, MsgDataFrame]);
      logger.info(`************ SpeechEmoReCogRQ_m(${SpeechEmoRecogRQ_m_req.byteLength}바이트) *****************`);
      logger.info(SpeechEmoRecogRQ_m_req);
      logger.info(`**************************************************************\n`)

      let SpeechEmoRecogRQ_m_res = SpeechEmoRecogRQ_m.parse(Buffer.from(SpeechEmoRecogRQ_m_req, 'hex'));
      let transmit_sql = `INSERT INTO emo_transmit_info (emo_transmit_info_seq, callinfo_id, file_name, agent_id, file_slice_cnt, det_ip_addr, interface_type, interface_dt, interface_return, insert_dt)
                          VALUES (NOW(3) ,'${callId}', '${userId}', '${agentId}', ${Number(numSlice)}, '${speakingIp}', '1', NOW(3), '1', NOW(3))`;

      // socket.write(data, encoding, callback);
      // 소켓에 데이터를 보낼 수 있는 메소드
      // 데이터의 기본 인코딩은 'UTF8'
      // 버퍼에 쌓인 데이터가 성공적으로 전송(flush)되었으면 true 반환
      // 데이터의 일부나 전체가 사용자 메모리에 큐되었다면 false를 반환
      // buffer가 모두 비워졌을 경우, drain이벤트가 발생
      if (bEtriSocket.write(SpeechEmoRecogRQ_m_req) === true) {
        logger.info(`[버퍼에 쌓인 데이터 성공적으로 전송]`);
        logger.info(`[감성인지 요청 메세지 parse]`);
        logger.info(SpeechEmoRecogRQ_m_res);

        try {
          connection.query(transmit_sql, function (err, result) {
            if (err) {
              logger.error(err);
              connection.end();
            }
            logger.info('[TRANSMIT_SQL 성공 결과]\n' + transmit_sql);

            fs.readdir("./3_sliced_records/", function (err, fileList) {
              if (err) { logger.error(err); }

              fs.rename(`./3_sliced_records/${fileList[0]}`, `./4_send_records/${fileList[0]}`, function (err) {
                if (err) { logger.error(err); }

                fs.unlink(`./4_send_records/${fileList[0]}`, function (err) {
                  if (err) { logger.error(err); }
                });
              });
            });
          });
        } catch (err) { logger.error(err); }
      } else {
        logger.info(`[데이터의 일부나 전체가 사용자 메모리에 큐]`);
        logger.info(`[감성인지 요청 메세지 parse]`);
        logger.info(SpeechEmoRecogRQ_m_res);

        try {
          connection.query(transmit_sql, function (err, result) {
            if (err) {
              logger.error(err);
              connection.end();
            }
            logger.info('[TRANSMIT_SQL 성공 결과]\n' + transmit_sql);

            fs.readdir("./3_sliced_records/", function (err, fileList) {
              if (err) { logger.error(err); }

              fs.rename(`./3_sliced_records/${fileList[0]}`, `./4_send_records/${fileList[0]}`, function (err) {
                if (err) { logger.error(err); }

                fs.unlink(`./4_send_records/${fileList[0]}`, function (err) {
                  if (err) { logger.error(err); }
                });
              });
            });
          });
        } catch (err) { logger.error(err); }
      }
    });
  } catch (err) { logger.error(err); }
}

////////////////////////////////// ETRI 서버에 소켓 연결(2개 포트) //////////////////////////////////////////////
let agent_id_1;
// 0. 사용자 등록 시간 업데이트
function uptUser() {
  let upt_send_dt = `UPDATE emo_agent_info 
                    SET userinfo_send_dt = NOW(3),
                      update_dt = NOW(3)
                    WHERE agent_id = ${agent_id_1};`;

  connection.query(upt_send_dt, function (err, results) {
    if (err) {
      logger.error(err);
      connection.end();
    }

    logger.info(`[시간 업데이트 쿼리]\n${upt_send_dt}`);
    logger.info(`[사용자(상담사) 등록 시간 업데이트 성공]\n${JSON.stringify(results)}`);
  });

  agent_id_1 = '';
}

// 0. 상담사 로그인 인증 시간 업데이트
function authenUser() {
  // 상담사(서비스) 인증시간 업데이트
  let upt_send_dt1 = `UPDATE emo_agent_info 
                      SET erkserviceconn_send_dt = NOW(3),
                        update_dt = NOW(3)
                      WHERE agent_id = ${agent_id_1};`;

  connection.query(upt_send_dt1, function (err, result) {
    if (err) {
      logger.error(err);
      connection.end();
    }

    logger.info(`[시간 업데이트 쿼리]\n${upt_send_dt1}`);
    logger.info(`[사용자(상담사) 인증 시간 업데이트 성공]\n${JSON.stringify(result)}`);
  });

  agent_id_1 = '';
}

// mysql 연결
let connection = mysql.createConnection({
  host: "211.41.186.209",
  user: "root",
  password: "nb1234",
  database: "ETRI_EMOTION",
  multipleStatements: true,
  port: 3306
});

// 사업자 및 상담사(사용자) 등록 & 상담사(서비스) 인증
let aHOST = '211.41.186.209';
let aPORT = 11111;
let aEtriSocket = new net.Socket();

// 음성 데이터 및 감성인지 결과 송수신
let bHost = '211.41.186.209';
let bPORT = 11117;
let bEtriSocket = new net.Socket();

// 1. [ 첫번째 소켓 identify ] 사업자 등록 및 상담사(사용자) 등록 & 상담사 인증 인터페이스
aEtriSocket.connect(aPORT, aHOST, function (err) {
  if (err) {
    logger.error(err);
    connection.destroy();
  }

  // 1.1 aHOST 및 PORT 체크
  logger.info(`{"CONNECTED TO ${aHOST}:${aPORT}"}`);
  try {
    // 1.2 사업자 DB 초기 데이터 설정 (임의의로 미리 설정)
    let reg_query = `UPDATE emo_provider_info SET insert_dt = NOW(3);`;

    connection.query(reg_query, function (err, result) {
      if (err) {
        logger.error(err);
        connection.end();
      }
      logger.info(`[UPDATE emo_provier_info 결과]: ${reg_query}`);
      logger.info(`${JSON.stringify(result)}`);

      // 1.3 사업자 등록 요청 메세지 전송
      let provide_buffer = `SELECT
                              CONCAT(RPAD(org_name, 16, ' '),
                                RPAD(org_pwd, 16, ' '),
                                LPAD(CONV(service_duration, 10, 16), 8, '0'),
                                LPAD(CONV(user_number, 10, 16), 10, '0'),
                                LPAD(CONV(service_type, 10, 16), 2, '0') 
                              ) AS provideBuffer
                            FROM emo_provider_info;`;

      connection.query(provide_buffer, function (err, result) {
        if (err) {
          logger.error(err);
          connection.end();
        }
        logger.info(`[PROVIDE_BUFFER 결과]\n${provide_buffer}`);
        logger.info(`[PROVIDE BUFFER 길이]: ${(result[0].provideBuffer).length}`);
        logger.info(`[PROVIDE BUFFER 내용]: ${result[0].provideBuffer}`);

        // 메세지 전송 결과가 true면 db 업데이트
        if (aEtriSocket.write(`${result[0].provideBuffer}`) == true) {
          let upt_send_dt = `UPDATE emo_provider_info SET send_dt = NOW(3);`;
          connection.query(upt_send_dt, function (err, result) {
            if (err) {
              logger.error(err);
              connection.end();
            }
            logger.info(result);
          });
        } else {
          logger.info('소켓 전송 결과: FALSE');
          return false
        }
      });
    });
  } catch (err) { logger.error(err); }

  aEtriSocket.on('data', function (data) {
    try {
      // 1. [사업자 등록] 요쳥 결과 메세지 수신
      if (data.byteLength == 19) {
        // 1.4 사업자 등록 요쳥 결과 메세지 수신
        let provide_res = AddServiceProviderInfoRP_m.parse(Buffer.from(data, 'hex'));

        // 1.4.1 처리 결과가 ok면
        if (provide_res.ResultType == 0) {
          let AddService_Rp = AddServiceProviderInfoRP_m.parse(Buffer.from(data, 'hex'));

          logger.info(`==================== [사업자 등록] 정상 (${data.byteLength}바이트) =======================\n${JSON.stringify(AddService_Rp)}\n
                      ==========================================================================`);

          // 1.4.2 사업자 테이블 업데이트
          let pro_upt_query = `UPDATE emo_provider_info
                              SET recv_dt = NOW(3), 
                                result_type = ${AddService_Rp.ResultType},
                                org_id = ${AddService_Rp.OrgId},
                                update_dt = NOW(3);`;

          let usr_reg_buffer = `SELECT
                                  CONCAT(
                                    RPAD(a.org_name, 16, ' '),
                                    RPAD(a.agent_name, 16, ' '),
                                    RPAD(a.login_pw, 16, ' '),
                                    LPAD(CONV(b.service_duration, 10, 16), 8, '0'),
                                    a.age,
                                    a.sex,
                                    a.userinfo_userType
                                  ) as addUser,
                                  agent_id,
                                  CHAR_LENGTH(
                                    CONCAT(
                                      RPAD(a.org_name, 16, ' '),
                                      RPAD(a.agent_name, 16, ' '),
                                      RPAD(a.login_pw, 16, ' '),
                                      LPAD(CONV(b.service_duration, 10, 16), 8, '0'),
                                      a.age,
                                      a.sex,
                                      a.userinfo_userType
                                    )
                                  ) AS strLength
                                FROM emo_agent_info a
                                LEFT OUTER JOIN emo_provider_info b
                                ON a.org_name = b.org_name
                                WHERE user_type = 1;`;

          connection.query(pro_upt_query, function (err, result) {
            if (err) {
              logger.error(err);
              connection.end();
            }
            logger.info(`[사업자 등록 업데이트 쿼리]\n${pro_upt_query}`);
            logger.info(`[사업자 등록 업데이트 결과]\n${JSON.stringify(result)}`);

            // 2. 사용자(상담사) 프로파일링 등록 기능 ( org_name = neighbor system인것에 대해 )
            connection.query(usr_reg_buffer, function (err, result) {
              if (err) {
                logger.error(err);
                connection.end();
              }

              // 2.1 메세지 전송시간 업데이트
              for (let i = 0; i < result.length; i++) {
                logger.info(`[USR_REG_BUFFER ${i + 1}번째 쿼리 조회 결과]\n${usr_reg_buffer}`);
                logger.info(`[조회 결과 ${i + 1}번째 확인]\n${JSON.stringify(result[i])}`);

                // 2.1.1 사용자 등록 프로파일링 메세지 전송
                if (aEtriSocket.write(`${result[i].addUser}`) == true) {
                  logger.info(`[사용자(상담사) 등록 - 전송 결과]: TRUE`);

                  agent_id_1 = result[i].agent_id;

                  logger.info(`[사용자 등록 - 보낸 메세지] : ${result[i].addUser}`);
                  logger.info(`[사용자 등록 - 보낸 길이]   : ${result[i].strLength}`);

                  return uptUser()
                } else {
                  logger.info(`[사용자(상담사) 등록 - 전송 결과]: FALSE`);
                }
              }
            });
          });
        } else {
          logger.info(`==================== [사업자 등록] 비정상 (${data.byteLength}바이트) =======================`);
          let err_AddService_Rp = AddServiceProviderInfoRP_m.parse(Buffer.from(data, 'hex'));
          logger.info(err_AddService_Rp);
          logger.info(`처리 결과 오류 유형: ${err_AddService_Rp.ResultType}`);
          logger.info(`========================================================================`);

          let err_upt_query = `UPDATE emo_provider_info
                              SET result_type = ${err_AddService_Rp.ResultType}, update_dt = NOW(3);`;
          try {
            connection.query(err_upt_query, function (err, result) {
              if (err) {
                logger.error(err);
                connection.end();
              }
              logger.info(`[오류 처리 업데이트]\n${err_upt_query}`);
              logger.info(result);
            });

            connection.end();
          } catch (err) { logger.error(err); }
        }
      } else if (data.byteLength == 37) { 
        // 2. [사용자 등록] 요쳥 결과 메세지 수신
        let addUser_Rp = AddUserInfoRP_m.parse(Buffer.from(data, 'hex'));

        // 처리 결과가 ok면
        if (addUser_Rp.ResultType == 0) {
          logger.info(`========================= [사용자 등록] 정상 (${data.byteLength}바이트) =========================`);
          logger.info(`${JSON.stringify(addUser_Rp)}`);
          logger.info(`===========================================================================`);

          // 2.1 [사용자 등록] 요청 결과 데이터 업데이트
          let usr_recv_udt = `UPDATE emo_agent_info 
                              SET update_dt = NOW(3),
                                userinfo_recv_dt = NOW(3),
                                userinfo_userid = ${addUser_Rp.UserId},
                                userinfo_return_code = ${addUser_Rp.ResultType}
                              WHERE agent_name = RTRIM('${addUser_Rp.UserName}');`;

          // 3. 상담사(서비스) 로그인 인증
          let usr_service_buffer = `SELECT
                                    CONCAT(LPAD(CONV(0, 10, 16), 2, '0'),
                                    LPAD(CONV(13516, 10, 16), 4, '0'),
                                    LPAD(CONV(userinfo_userId, 10, 16), 8, '0'),
                                    ( SELECT
                                    LPAD(CONV(LEFT(DATE_FORMAT(NOW(3), '%H%i%S%f'), 9), 10, 16), 8, '0')),
                                    LPAD(CONV(dev_platform, 10, 16), 2, '0') ) AS msgHeader,
                                    agent_id,
                                    LENGTH(CONCAT(LPAD(CONV(0, 10, 16), 2, '0'),
                                      LPAD(CONV(13516, 10, 16), 4, '0'),
                                      LPAD(CONV(userinfo_userId, 10, 16), 8, '0'),
                                      ( SELECT
                                      LPAD(CONV(LEFT(DATE_FORMAT(NOW(3), '%H%i%S%f'), 9), 10, 16), 8, '0')),
                                      LPAD(CONV(dev_platform, 10, 16), 2, '0')
                                  )) AS strLength
                                  FROM emo_agent_info
                                  WHERE org_name = 'neighbor system'
                                  AND agent_name = RTRIM('${addUser_Rp.UserName}');`;

          connection.query(usr_recv_udt, function (err, result) {
            if (err) {
              logger.error(err);
              connection.end();
            }

            logger.info(`[사용자 등록 메세지 결과 업데이트 성공]\n${usr_recv_udt}`);

            connection.query(usr_service_buffer, function (err, result) {
              if (err) {
                logger.error(err);
                connection.end();
              }

              // 3.1 상담사 로그인 요청 전송
              logger.info(`[USR_SERVICE_BUFFER 쿼리 결과]\n${usr_service_buffer}`);
              logger.info(`[조회 결과 확인]: ${JSON.stringify(result[0].msgHeader)}`);

              // 3.1.1 상담사 로그인 메세지 전송
              if (aEtriSocket.write(`${Buffer.from(result[0].msgHeader, 'hex')}`) == true) {
                logger.info(`[msgHeader 전송 결과] - TRUE`);

                agent_id_1 = result[0].agent_id;
                authenUser();

                logger.info(`[상담사(로그인) - 보낸 메세지] : ${result[0].msgHeader}`);
                logger.info(`[상담사(로그인) - 보낸 길이]   : ${result[0].strLength}`);
              } else {
                logger.info(`[사용자(상담사) 로그인 - 전송 결과]: FALSE`);
              }
            });
          });
        } else {
          let addUser_Rp = AddUserInfoRP_m.parse(Buffer.from(data, 'hex'));

          logger.info(`==================== [사용자 등록] 비정상 (${data.byteLength}바이트) ====================`);
          logger.info(`${addUser_Rp}`);
          logger.info(`${addUser_Rp.ResultType}`);
          logger.info(`============================================================`);

          let err_usr_recv = `UPDATE emo_agent_info
                              SET update_dt = NOW(3), userinfo_recv_dt = NOW(3), userinfo_return_code = ${addUser_Rp.ResultType};`;

          connection.query(err_usr_recv, function (err, result) {
            if (err) {
              logger.error(err);
              connection.end();
            }

            logger.info(JSON.stringify(result));
            connection.end();
          });
        }
      } else {
        // 3.1 상담사 인증 결과 데이터 수신에 대한 부분
        let recvData = ErkMsgHeader.parse(Buffer.from(data, 'hex'));

        if (recvData.MsgType == 1) {
          // 서비스 인증 응답 메세지 타입일 때
          logger.info(`==================== [상담사 인증] 정상 (${data.byteLength}바이트) =======================`);
          let serviceRpData = ErkServiceConnRP_m.parse(Buffer.from(data, 'hex'));
          logger.info(serviceRpData);
          logger.info(`========================================================================================`);

          // det_ip 데이터 전처리 및 전역 변수에 저장
          speakingIp = parseInt(Number(serviceRpData.IpAddr1).toString()).toString() + '.' +
            parseInt(Number(serviceRpData.IpAddr2).toString()).toString() + '.' +
            parseInt(Number(serviceRpData.IpAddr3).toString()).toString() + '.' +
            parseInt(Number(serviceRpData.IpAddr4).toString()).toString();

          let emoenv_sql4 = `UPDATE emo_agent_info
                            SET update_dt = NOW(3), 
                              erkserviceconn_recv_dt = NOW(3), 
                              erkserviceconn_return_code = ${serviceRpData.ReturnCode},
                              erkserviceconn_return_engine_type = ${serviceRpData.EngineType},
                              erkserviceconn_return_engine_condition = ${serviceRpData.EngineCondition},
                              erkserviceconn_return_ipAddr = '${speakingIp}', 
                              erkserviceconn_return_portNumber = '${serviceRpData.PortNumber}' 
                            WHERE userinfo_userId = '${serviceRpData.UserId}';`;

          connection.query(emoenv_sql4, function (err, result) {
            if (err) {
              logger.error(err);
              connection.end();
            }

            logger.info(`[EMOENV_SQL4 쿼리]\n${emoenv_sql4}`);
          });
        } else {
          let addUser_Rp = ErkMsgHeader.parse(Buffer.from(data, 'hex'));

          logger.info(`==================== [상담사 인증] 비정상 (${data.byteLength}바이트) =======================`);
          logger.info(addUser_Rp);
          logger.info(addUser_Rp.ResultType);
          logger.info(`========================================================================`);

          let err_authen_recv = `UPDATE emo_agent_info
                                SET update_dt = NOW(3), erkserviceconn_recv_dt = NOW(3), erkserviceconn_return_code = ${addUser_Rp.ResultType};`;

          connection.query(err_authen_recv, function (err, result) {
            if (err) {
              logger.error(err);
              connection.end();
            }

            logger.info(JSON.stringify(result));
            connection.end();
          });
        }
      }
    } catch (err) { logger.error(err); }
  });

  aEtriSocket.on('end', () => {
    logger.info('aEtriSocket IS DISCONNECTED FROM SERVER!');
  });

  aEtriSocket.on('error', function (err) {
    logger.error(err);
    aEtriSocket.destroy();
  });

  aEtriSocket.on('close', function () {
    logger.info('aEtriSocket SOCKET CLOSED!'); 
  });
});

// [ 두번째 소켓 message ] 음성 데이터 송수신 인터페이스
bEtriSocket.connect(bPORT, bHost, function (err) {
  if (err) {
    logger.error(err);
    connection.destroy();
  }
  // 2.1 소켓이 연결되어있는 동안 TCP 통신(전송주기 1초)
  logger.info(`{"CONNECTED TO ${bHost}:${bPORT}"}`);

  // 2.2. 서비스 인증 요청 (가장 우선 처리 되어야 하는 부분)
  cron.schedule('*/1 * * * * *', function () {
    // 서비스 인증 테이블에 목적지 ip가 들어있으면 파일 전송 시작
    if (speakingIp != null) {
      // 음성파일이 들어있는 디렉토리 검색
      fs.readdir("./3_sliced_records/", function (err, fileList) {
        if (err) { logger.error(err); }

        for (let i = 0; i < 6; i++) {
          // 해당 디렉토리에 파일이 있으면
          if (fs.existsSync(`./3_sliced_records/${fileList[i]}`) === true) {
            // 파일 크기 
            content = fs.readFileSync(`./3_sliced_records/${fileList[i]}`);
            contentLength = content.byteLength;

            // UserId(가입자 정보)에는 미리 설정한 파일명 자체로 설정, 조회를 위한 agent_id값은 파일에서 빼온다
            userId    = fileList[i].slice(0, 10); // 월일시퀀스분할횟수 파일명
            agentId   = fileList[i].substring(24, 26); // 상담원의 id
            callId    = fileList[i].substring(27, fileList[i].lastIndexOf('_')); // 콜id
            callTime  = fileList[i].substring(17, 23) + '000'; // 통화시작시간(시분초까지만) + 밀리세컨(변환할때 0채우기)
            numSlice  = fileList[i].substring(fileList[i].lastIndexOf('_') + 1, fileList[i].lastIndexOf('.wav')); // 잘린 파일 번호

            logger.info(`-----------------------------------`);
            logger.info(`[ 디렉토리     : ${i + 1}번째 파일(${fileList[i]}) ]`);
            logger.info(`[ 파일크기     : ${contentLength} ]`);
            logger.info(`[ 16진수       : ${contentLength.toString(16)} ]`);
            logger.info(`[ 월일시퀀스   : ${userId} ]`);
            logger.info(`[ 상담사 ID    : ${agentId} ]`);
            logger.info(`[ 콜 ID        : ${callId} ]`);
            logger.info(`[ 통화시작시간 : ${callTime} ]`);
            logger.info(`[ 분할파일번호 : ${numSlice} ]`);
            logger.info(`-----------------------------------\n`);

            // TCP 메세지 송신
            tcpMessage(contentLength, userId, agentId, callId, numSlice);
          } else {
            if (i % 7 == 0) {
              logger.info('TCP 통신 할 파일 없음');
            }
          }
        }
      });
    } else {
      logger.error(`목적지 IP 없음`);
      return false;
    }
  });

  bEtriSocket.on('data', function (data) {
    let recvData = ErkMsgHeader.parse(Buffer.from(data, 'hex'));

    if (recvData.MsgType == 20) {
      // 메세지 타입이 감성인지 메세지 완료일 시
      logger.info(`==================== [음성인지 분석 수신 정상] (${data.byteLength}바이트) =======================`);
      let returnEmotionData = EmoRecogRP_m.parse(Buffer.from(data, 'hex'));
      logger.info(returnEmotionData);
      logger.info(`=========================================================================`);

      let jsonData = (JSON.parse(JSON.stringify(returnEmotionData)));

      // 파일전송에 대한 리턴 및 데이터가 정상이면
      if (jsonData.ReturnCode == 0) {
        if (jsonData.OrgId === 13516) {
          try {
            // INSERT QUERYING FOR RETURN TCP MESSAGE
            let insert_sql = `INSERT INTO emo_emotion_info 
                              (emo_emotion_info_seq, message_type, agent_id, org_id, file_name, message_timestamp, dev_platform, 
                                resreq_dt, return_code, emo_recog_time, emotion_type, accuracy, insert_dt)
                              VALUES (NOW(3),
                                      ${jsonData.MsgType},
                                      ( SELECT agent_id 
                                        FROM emo_agent_info
                                        WHERE userinfo_userid = ${jsonData.UserId} ),
                                      ${jsonData.OrgId},
                                      LPAD(${jsonData.MsgTimeStamp}, '10', '0'),
                                      LPAD(${jsonData.MsgTimeStamp}, '10', '0'),
                                      ${jsonData.DevPlatform},
                                      NOW(3),
                                      ${jsonData.ReturnCode},
                                      LPAD(${jsonData.EmoRecogTime}, '10', '0'),
                                      ${jsonData.Emotion},
                                      ${jsonData.Accuracy.toFixed(4)},
                                      NOW(3))`;

            connection.query(insert_sql, function (err, result) {
              if (err) {
                logger.error(err);
                connection.end();
              }

              logger.info(`[EMO_EMOTION_INFO INSERT 성공 결과]\n${insert_sql}`);
            });
          } catch (err) { logger.error(err); }
        } else {
          logger.info(jsonData);
          logger.info('잘못된 데이터');
        }
      } else {
        logger.info(`[처리 결과] 오류 코드: ${jsonData.ReturnCode}`);

        return false
      }
    } else {
      logger.info(`==================== [음성 파일 송수신] 비정상 (${data.byteLength}바이트) =======================`);

      let returnEmotionData = EmoRecogRP_m.parse(Buffer.from(data, 'hex'));
      let jsonData = (JSON.parse(JSON.stringify(returnEmotionData)));

      logger.info(data);
      logger.info(`[수신 메세지 타입] : ${returnEmotionData.MsgType}`);
      logger.info(`[수신 오류 코드]   : ${jsonData.ReturnCode}`);
      logger.info(`=========================================================================`);

      return false
    }
  });

  bEtriSocket.on('end', () => {
    logger.info('DISCONNECTED FROM SERVER');
  });

  bEtriSocket.on('error', function (err) {
    logger.error(err);
    bEtriSocket.destroy();
  });

  bEtriSocket.on('close', function () {
    logger.info('SOCKET CLOSED');
  });
});

module.exports = { beforeOffer };