'use strict'

// app.js는 미들웨어 (node module 로딩, 변수 초기화, 오브젝트 선언 및 라우팅) 역할
// 정적 파일 호스팅
// express 앱 내 모듈 사용 관련 설정(http 요청을 받기위한 모듈, POST 요청 데이터 접근을 위한 모듈 등)
const cookieParser              = require('cookie-parser');
const bodyParser                = require('body-parser');
const Parser                    = require('binary-parser').Parser;

const browserify                = require('browserify-middleware');

const { readdirSync, statSync } = require('fs');
const { join }                  = require('path');
const { mount }                 = require('./lib/server/rest/connectionsapi');
const WebRtcConnectionManager   = require('./lib/server/connections/webrtcconnectionmanager');

const express                   = require('express');
const app                       = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static('public'));

const mysql                     = require('./database/connect/maria')();
const connection                = mysql.init();
mysql.db_open(connection);
const net                       = require('net');

const session                   = require('express-session');
const MySQLStore                = require('express-mysql-session')(session);

const https                     = require('https');
const fs                        = require('fs');
const moment                    = require('moment');

const logger                    = require('/home/test/ETRI/230714_ETRI/logs/logger');
const { connect }               = require('http2');
const cron                      = require('node-cron');
const sleep                     = require('sleep');

const Router                    = require('./routes/router');

app.use(cookieParser());
app.use(bodyParser.json());

app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');
app.engine('html', require('ejs').renderFile);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static('public'));

// MySQL Session Store
let options = {
    host: '211.41.186.209',
    port: '3306',
    user: 'root',
    password: 'nb1234',
    database: 'ETRI_EMOTION'
}
let sessionStore = new MySQLStore(options);

app.use(
    session({
        key: "session_cookie_name",
        secret: '@#@$MYSIGN#@$#$',
        resave: false, // 세션을 언제나 저장할지 설정함
        saveUninitialized: true, // 세션이 저장되기 전 uninitialized 상태로 미리 만들어 저장
        store: sessionStore, // 이렇게 하면 session DB에 세션 테이블이 생긴다
        cookie: {
            max: 600000,
            rolling: true
        }
    })
);

// [ 로그인 & 로그아웃 ]
app.use('/', Router);

// [ 상담사 ]
app.use('/callCenter/agent_id', Router);
app.use('/callCenter/call_history', Router);
app.use('/callCenter/emotion_type', Router);
app.use('/callCenter/clients_details', Router);
app.use('/restAPI/update_call_end', Router);

// [ 관리자 ]
app.use('/manage', Router);
app.use('/manage/login', Router);
app.use('/manage/statistics', Router);
app.use('/manage/230811_statistics', Router);
app.use('/manage/230811_dashboard', Router);
app.use('/manage/monitoring', Router);
app.use('/manage/monitoring_emo', Router);
app.use('/manage/counseling', Router);
app.use('/manage/counseling_manage', Router);
app.use('/manage/counseling_submit', Router);
app.use('/manage/counseling_edit', Router);
app.use('/manage/counseling_deleting', Router);
app.use('/manage/coaching_message', Router);
app.use('/manage/counsel_history', Router);

// ../lib 디렉토리 밑에 하위 디렉토리 검색 → [ 'browser', 'client', 'server' ]
const examplesDirectory = join(__dirname, 'lib');
const examples = readdirSync(examplesDirectory).filter(path => statSync(join(examplesDirectory, path)).isDirectory());

function setupExample(example) {
    logger.info(`example is ${example}`);
    
    const indexPath = join(examplesDirectory, 'client/index.js');
    const clientPath = join(examplesDirectory, 'client/client.js');
    const serverPath = join(examplesDirectory, 'server/server.js');

    app.use(`/${indexPath}`, browserify(clientPath));
    app.get(`/${indexPath}`, (req, res) => {
        logger.info('dirname : ' + __dirname + '********************');
        res.sendFile(join(__dirname, 'views/manage', 'index.ejs'));
    });

    const options = require(serverPath);
    const connectionManager = WebRtcConnectionManager.create(options);
    mount(app, connectionManager, `/${example}`);

    return connectionManager;
}

const connectionManagers = examples.reduce((connectionManagers, example) => {
    const connectionManager = setupExample(example);
    return connectionManagers.set(example, connectionManager);
}, new Map());

const https_options = {
    key: fs.readFileSync('./selfsigned.key'),
    cert: fs.readFileSync('./selfsigned_1.crt')
}

// 특정 포트로 서버 연결(본사 → 임의의 포트, 다온빌딩 → 8888)
const httpsServer = https.createServer(https_options, app);
const io = require('socket.io')(httpsServer);
const HTTPServer = httpsServer.listen(8888, () => {
    const address = HTTPServer.address();
    logger.info(`${JSON.stringify(address)}`);

    HTTPServer.once('close', () => {
        connectionManagers.forEach(connectionManager => connectionManager.close());
    });
});

//////////////// POST 로그인 /////////////////
let sendUserID;   // 상담사 id
let sendUserName;
let userType;     // 1: 상담사, 2: 관리자

app.post('/manage/login', function (req, res) {
    logger.info('** 로그인 프로세스 호출 **');

    // 서비스 인증이 진행된 경우(userinfo_userId와 org_id가 있을 시) 로그인 진행
    let login_chk_query = `SELECT org_id, org_name FROM emo_provider_info;`;

    connection.query(login_chk_query, function (error, results) {
        if (error) {
            logger.error(error);
            connection.end();
        }

        if (results[0].org_id != null && results[0].org_name != null) {
            // 사용자가 입력한 아이디, 패스워드 값 전달받음
            let login_id_t = req.body.login_id;
            let login_pw_t = req.body.login_pw;

            logger.info(`사용자id: ${login_id_t}`);
            logger.info(`사용자pw: ${login_pw_t}`);

            if (login_id_t && login_pw_t) {
                let login_query = `SELECT * 
                                    FROM emo_agent_info 
                                    WHERE login_id = '${login_id_t}' 
                                    AND login_pw = '${login_pw_t}';`;

                connection.query(login_query, function (error, results) {
                    if (error) {
                        logger.error(error);
                        connection.end();
                    }

                    if (results.length > 0) {
                        req.session.authenticate = true;
                        req.session.user_type = results[0].user_type;
                        req.session.agent_name = results[0].agent_name;
                        req.session.agent_id = results[0].agent_id;
                        req.session.call_id = null;

                        sendUserID = results[0].agent_id;
                        sendUserName = results[0].agent_name;
                        userType = results[0].user_type;

                        let login_sql = `INSERT INTO emo_loginout_info (agent_name, agent_id, loginout_dt, loginout_type, user_type) 
                            VALUES ('${req.session.agent_name}', '${req.session.agent_id}', NOW(3), 'I', ${req.session.user_type})`;

                        if (req.session.user_type == 2) {
                            req.session.save(() => {
                                connection.query(login_sql, function (error, result) {
                                    if (error) {
                                        connection.end();
                                        logger.error(err);
                                    }
                                    logger.info("* Login Success & Data Inserted! *");
                                });

                                res.redirect('/manage');
                            });
                        } else {
                            req.session.save(() => {
                                connection.query(login_sql, function (error, result) {
                                    if (error) {
                                        connection.end();
                                        logger.error(err);
                                    }
                                    logger.info("Login Success & Data Inserted!");
                                });

                                res.render('manage/index');
                            });
                        }
                    } else {
                        logger.info('로그인 정보 불일치');
                        res.send('<script type="text/javascript">alert("로그인 정보가 일치하지 않습니다."); document.location.href="/manage/login";</script>');
                        res.end();
                    }
                });
            } else {
                logger.info('ID & PW 입력 없음');
                res.send('<script type="text/javascript">alert("ID와 PW를 입력하세요."); document.location.href="/manage/login";</script>');
                res.end();
            }
        } else {
            logger.info('NO SERVICE AUTHENTICATED!');
            return false;
        }
    });
});

/////////////// GET 로그아웃 //////////////////
app.get('/process/logout', function (req, res) {
    logger.info('** 로그아웃 프로세스 호출 **');
    let logout_sql = `INSERT INTO emo_loginout_info (agent_name, agent_id, loginout_dt, loginout_type, user_type) 
                    VALUES ('${req.session.agent_name}', '${req.session.agent_id}', NOW(3), 'O', ${req.session.user_type})`;

    if (req.session.authenticate) {
        connection.query(logout_sql, function (err, result) {
            if (err) {
                logger.error(err);
                connection.end();
            }

            logger.info("로그아웃 성공 & 데이터 수정 성공");
        });

        delete req.session.user;

        req.session.destroy(function (err) {
            if (err) {
                logger.info('세션 삭제 에러');
                return;
            } else {
                logger.info(`현재 loginIds: ${JSON.stringify(loginIDs)}`);
                logger.info('세션 삭제 성공');
                res.redirect('/manage/login');
            }
        });
    } else {
        logger.info('로그인 상태 아님');
        res.redirect('/manage/login');
    }
});

// 현재 날짜 구하기
function getCurrentDate() {
    let date = new Date();

    let year = date.getFullYear().toString();

    let month = date.getMonth() + 1;
    month = month < 10 ? '0' + month.toString() : month.toString();

    let day = date.getDate();
    day = day < 10 ? '0' + day.toString() : day.toString();

    let hours = date.getHours();
    hours = hours < 10 ? '0' + hours.toString() : hours.toString();

    let minutes = date.getMinutes();
    minutes = minutes < 10 ? '0' + minutes.toString() : minutes.toString();

    let seconds = date.getS

    return year + "년 " + month + "월 " + day + "일 " + hours + "시 " + minutes + "분 ";
}

// [자동 코칭 관련]
// 1. 3초마다 selectAutoCoach 함수 실행
function callProcedure() {
    logger.info('>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> [10, 30, 60 callprocedures]');
    // 3초마다 (10, 30, 60초)를 기준으로 하는 프로시저 호출
    let auto_coach_procedure_10 = `CALL emoCoachingMessage10_Proc('${getYearMonthDay()}');`;
    let auto_coach_procedure_30 = `CALL emoCoachingMessage30_Proc('${getYearMonthDay()}');`;
    let auto_coach_procedure_60 = `CALL emoCoachingMessage60_Proc('${getYearMonthDay()}');`;

    connection.query(auto_coach_procedure_10 + auto_coach_procedure_30 + auto_coach_procedure_60, function (err, results, fileds) {
        if (err) {
            logger.error(err);
            connection.end();
        }

        // 프로시저 호출 후 자동 검색 조건 검색
        if (sendUserID != null) {
            logger.info('>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> selectAutoCoach 함수 실행');
            return selectAutoCoach();
        } else {
            logger.info(`일시적 세션 오류`);
        }
    });
}

// 2. 자동코칭이 필요한 데이터를 조회 및 메세지 전송
function selectAutoCoach() {
    let searchAuto_query = `SELECT 
                                DATE_FORMAT(call_date, '%Y년 %m월 %d일') AS call_date,
                                auto_standard,
                                auto_seq,
                                CONCAT(SUBSTR(call_time, 1, 2),'시 ', SUBSTR(call_time, 3, 2),'분 ', SUBSTR(call_time, 5, 2),'초') AS call_time,
                                agent_id,
                                agent_anger,
                                agent_sad,
                                auto_detail,
                                DATE_FORMAT(insert_dt, '%Y%m%d%H%i%s') AS insert_dt
                            FROM emo_coaching_message
                            WHERE agent_id IN(1, 2, 3)
                            AND auto_coach = 'A'
                            AND send_yn = 'N';`;

    connection.query(searchAuto_query, function (err, result) {
        if (err) {
            logger.error(err);
            connection.end();
        }
        logger.info(`[자동 코칭 예약 테이블 조회 쿼리 결과]\n${searchAuto_query}`);
        logger.info(`[자동 코칭 예약 조건 결과 및 개수 : ${result.length}개] →→ ${JSON.stringify(result)}`);

        if (result.length != 0) {
            logger.info(`[자동 코칭 조회 쿼리 결과]\n${JSON.stringify(result)}`);

            if (loginIDs != null) {
                logger.info(`[접속 중인 상담사]\n${JSON.stringify(loginIDs)}`);
                // 세션의 배열 요소 카운팅(접속중인 상담사)
                for (let i = 0; i < loginIDs.length; i++) {
                    // 자동 코칭 예약 조건 갯수 및 세션id와 같은 id가 있는지
                    for (let j = 0; j < result.length; j++) {
                        if (loginIDs[i].id == result[j].agent_id) {
                            logger.info(`>>>>>>>>>> [상담사${loginIDs[i]['id']}] 근무 중 <<<<<<<<<<`);

                            io.to(loginIDs[i]['socket']).emit('auto_msg', `   ──────────────── [시스템 메세지] ────────────────
    ※ 이 메세지는 시스템 메세지입니다. 세부 사항은 아래와 같습니다.
    [상담사 ID]         : ${result[j].agent_id}
    [기준시간 및 날짜]  : ${result[j].call_date} ${result[j].call_time}
    [화남 초과 횟수]    : ${result[j].agent_anger}회
    [슬픔 초과 횟수]    : ${result[j].agent_sad}회
    [메세지 내용]       : ${result[j].auto_detail}
────────────────────────────────────────`);

                            /* [메세지 발생시간]   : ${result[j].insert_dt}   [자동 코칭 번호]    : ${result[j].auto_seq} */

                            let query_callTime = result[j].call_time.replace('시', "");
                            query_callTime = query_callTime.replace('분', "");
                            query_callTime = query_callTime.replace('초', "");

                            let updateAuto_query = `UPDATE emo_coaching_message
                                                    SET send_yn = 'Y', send_dt = NOW(3)
                                                    WHERE call_time = REPLACE('${query_callTime}', ' ', '')
                                                    AND agent_id = ${result[j].agent_id}
                                                    AND auto_seq = ${result[j].auto_seq}
                                                    AND auto_standard = ${result[j].auto_standard};`;
                                                    
                            return updateAutoCoach(updateAuto_query);
                        } else {
                            logger.info('자동 코칭 조건에 맞는 상담사가 아님.');
                        }
                    }
                }
            } else {
                logger.info(`현재 접속중인 상담사가 없습니다.`);
            }
        } else {
            logger.info(`[자동 코칭 조건이 조회되지 않았습니다.]`);
        }
    });
}

// 3. 자동코칭 후 테이블 업데이트
function updateAutoCoach(updateAuto_query) {
    connection.query(updateAuto_query, function (err, result) {
        if (err) {
            logger.error(err);
            connection.end();
        }
        logger.info(`[자동 코칭 이력 업데이트 쿼리]\n${updateAuto_query}`);
    });

    return logger.info(`자동 코칭 후 DB 업데이트 성공.`);
}

// WEB SOCKET 연결 ( on으로 받고 emit으로 송신한다! )
const loginIDs = new Array();
let global_passive_info = new Array();

io.sockets.on('connection', function (socket) {
    // 소켓 연결 에러
    socket.on('error', (error) => {
        logger.error(error);
    });

    // 접속자 구분
    let req = socket.request;
    let ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    ip = ip.replace('::ffff:', 'IPv6 ');
    logger.info(ip);

    // 소켓 객체에 상담사 이름, id, 권한 정보 추가
    socket.agentName = sendUserName;
    socket.agent_id = sendUserID;
    socket.userType = userType;

    if (socket.userType) {
        loginIDs.push({
            socket: socket.id,
            user: socket.agentName,
            id: socket.agent_id,
            type: socket.userType,
        });
    }

    if (userType == 2) {
        logger.info(`상담관리자${sendUserID} 접속[${ip}]`);
        logger.info(`접속일시: ${getCurrentDate()}`);
    } else {
        logger.info(`상담사${sendUserID} 접속[${ip}]`);
        logger.info(`접속일시: ${getCurrentDate()}`);

        socket.emit('server_msg', `상담사${sendUserID} 접속[${ip}]`);
        socket.emit('server_msg', `접속일시: ${getCurrentDate()}`);
    }

    // 새로고침시 loginIDs 배열에서 중복되는 항목을 제거
    for (let num in loginIDs) {
        if (loginIDs[num]['user'] === socket.agentName && loginIDs[num]['socket'] != socket.id) {
            loginIDs.splice(num, 1);
        }
    }

    logger.info(`현재 loginIDs: ${JSON.stringify(loginIDs)}`);

    /////////////////////////////////// 시스템 자동 코칭 ///////////////////////////////////
    cron.schedule('*/3 * * * * *', function () {
        logger.info(`>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> [3초 스케줄 프로시저 호출]`);
        return callProcedure();
    });

    /////////////////////////////////// 상담사 수동 메세지 전송 ///////////////////////////////////
    app.get('/manage/coaching_submit', function (req, res) {
        if (!req.session)
            return res.render('manage/login');

        // 코칭 메세지, 특이사항, 코칭 기준시간
        let coach_msg = req.query.passive_msg_detail;
        let coach_etc = req.query.passCounsel_etc;
        let coach_standard = global_passive_info[1].substring(global_passive_info[1].length - 2);

        // 시간, 날짜 전처리
        global_passive_info[0] = global_passive_info[0].substring(0, 4) + global_passive_info[0].substring(6, 8) + global_passive_info[0].substring(10, 12);
        global_passive_info[1] = global_passive_info[1].substring(0, 2) + global_passive_info[1].substring(3, 5) + global_passive_info[1].substring(6, 8);

        logger.info(`수동 코칭 메세지 내용  : ** ${coach_msg} **`);
        logger.info(`전달 할 상담사 날짜    : ** ${global_passive_info[0]} **`);
        logger.info(`전달 할 상담사 시간    : ** ${global_passive_info[1]} **`);
        logger.info(`전달 할 상담사 이름    : ** ${global_passive_info[2]} **`);
        logger.info(`기준 시간              : ** ${coach_standard} **`);

        // socket 정보를 매핑하여 특정 클라이언트에게 전송  
        for (let num in loginIDs) {
            if (loginIDs[num]['user'] == global_passive_info[2].toString()) {
                logger.info('해당 상담사 접속중');
                logger.info(`[보낼 소켓 ID]: ${loginIDs[num]['socket']}`);

                io.to(loginIDs[num]['socket']).emit('admin_msg', ` ──────────────── [관리자 메세지] ────────────────
    ** ${loginIDs[num]['user']}님! 관리자로부터 메세지가 도착했습니다. **
    →→ "${coach_msg}"
    ────────────────────────────────────────`);

                let upt_pass_query = `UPDATE emo_coaching_message
                                        SET send_yn = 'Y', pass_etc = '${coach_etc}'
                                        WHERE agent_id = ${loginIDs[num]['id']}
                                        AND STR_TO_DATE('${global_passive_info[0]}', '%Y%m%d')
                                        AND call_time = '${global_passive_info[1]}'
                                        AND auto_standard = 30
                                        AND auto_coach = 'P';`;

                connection.query(upt_pass_query, function (err, result) {
                    if (err) {
                        logger.error(err);
                        connection.end();
                    }

                    logger.info(`[상담 코칭, 특이 사항 쿼리]\n${upt_pass_query}`);
                    logger.info(JSON.stringify(result));
                });

                global_passive_info = new Array();

                // 성공 res.send는 string, object, array 등을 보낼 수 있다. int형은 안됌
                return res.status(200).json({
                    message: "SUCCESS"
                });
            } else {
                logger.info('접속중인 상담사가 아닙니다.');
                global_passive_info = new Array();

                return res.status(200).json({
                    message: "FAILED"
                });
            }
        }
    });

    // 소켓 연결 해제
    socket.on('disconnect', (reason) => {
        try {
            for (let num in loginIDs) {
                if (loginIDs[num]['user'] === socket.agentName && loginIDs[num]['socket'] === socket.id) {
                    loginIDs.splice(num, 1);
                }
            }
        } catch (exception) {
            logger.info(exception);
        } finally {
            logger.info(`연결 해제 이유: ${reason}`);
            logger.info(`연결 종료[클라이언트IP: ${ip}, 상담사: ${socket.agentName}]`);
        }
    })

    // 코칭 전 해당 상담사 이름 전달
    socket.on('client_name', (data) => {
        logger.info(`[상담관리자가 보낸 상담사 이름]: ${data}`);

        global_passive_info.push(data);
        logger.info(`[전역변수 배열에 상담사 정보 저장] >>> ${global_passive_info}`);

        // io.sockets.emit: 모든 클라이언트에게 전송
        // socket.broadcast.emit: 새로 생성된 연결을 제외한 다른 클라이언트에게 전송
    });

    // 에러 발생(error) 이벤트 처리
    socket.on('error', (error) => { logger.error(`에러 발생: ${error}`); });
})