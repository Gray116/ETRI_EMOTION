'use strict'

// 요청에 대한 응답 처리(라우팅)를 하는 파일
// 응답할 때 웹문서를 랜더링(res 객체의 render 메서드를 이용, 템플릿엔진 사용)할 수 있음
// server.js 한 파일에서만 런칭할 수 있는 것이 아닌 router라는 것을 이용해서 여러가지 .js 파일에다가 원하는 코드를 짤 수 있다.
const express                   = require('express');
const app                       = express();
const router                    = express.Router();
const logger                    = require('/home/test/ETRI/230714_ETRI/logs/logger');

const mysql                     = require('../database/connect/maria')();
const connection                = mysql.init();
mysql.db_open(connection);

const session                   = require('express-session');
const MySQLStore                = require('express-mysql-session')(session);

const moment                    = require('moment');

// MySQL Session Store
let options = {
  host: '211.41.186.209',
  port: '3306',
  user: 'emo10',
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

// 년월일
function getYearMonthDay() {
  let date = new Date();

  // 년
  let year = date.getFullYear().toString();

  // 월(1~9월은 앞에 0)
  let month = date.getMonth() + 1;
  month = month < 10 ? '0' + month.toString() : month.toString();

  // 일(1~9일은 앞에 0)
  let day = date.getDate();
  day = day < 10 ? '0' + day.toString() : day.toString();

  return year + month + day
}

////////////// 로그인 화면 ///////////////////
router.get('/', (req, res, next) => {
  if (!req.session)
    return res.render('manage/login');

  if (req.session.authenticate) {
    if (req.session.user_type == 2) {
      return res.render('manage');
    } else {
      return res.render('manage/index');
    }
  }
});

////////////// GET 로그인 ///////////////////
router.get('/manage/login', (req, res) => {
    if (req.session.authenticate) {
        logger.info('이미 로그인 되어있어 페이지 이동');

        if (req.session.user_type == 2) {
            res.redirect('/manage');
            res.end();
        } else {
            res.render('manage/index');
            res.end();
        }
    } else {
        res.render('manage/login', {
            title: "로그인 페이지",
        });
    }
});

// 전화 받기
router.post('/restAPI/call_start', function (req, res) {
  // 세션으로부터 상담사 id 받아옴
  // let agent_id = req.session.agent_id;

  let getNum = req.body.data;
  let agent_id = Number(getNum);
  req.session.call_id = null;

  let insert_callData = `INSERT INTO emo_call_info (callinfo_id, agent_id, connect_dt) 
                        VALUES ( CONCAT(DATE_FORMAT(now(6), "%y%m%d%H"), LPAD(get_log_seq2(1),"7", "0")), ${agent_id}, NOW(3));`;

  let select_callData = `SELECT callinfo_id
                        FROM emo_call_info
                        WHERE agent_id = ${agent_id}
                        ORDER BY connect_dt DESC 
                        LIMIT 1;`;

  // agent_id, connect_dt(통화 시작 시간) 데이터 생성
  connection.query(insert_callData, function (error, result) {
    if (error) {
      logger.error(error);
      res.json([{ agent_id: 0, message: "fail" }]);

      connection.end();
    }
    logger.info(`[CALL 데이터 생성 성공]\n${insert_callData}`);

    // 해당 세션에 callinfo_id 담기
    connection.query(select_callData, function (err, result) {
      if (err) {
        logger.error(err);
        connection.end();
      }
      logger.info(`[CALLINFO_ID 조회 성공]\n${result}`);

      req.session.call_id = result[0].callinfo_id;
      res.send(result);
    });
  });
});


///////////// [상담사] ///////////////
// 상담사 ID값 가져오기
router.get('/callCenter/agent_id', function (req, res) {
    let send_agentID = req.session.agent_id;
    let getAgentId = `SELECT agent_id FROM emo_agent_info WHERE agent_id = ${send_agentID};`;

    connection.query(getAgentId, function (error, result, fields) {
        if (error) {
            logger.error(error);
            res.json([{ send_agentID: 0, message: "fail" }]);
            connection.end();
        } else {
            res.send(result);
        }
    })
});

// 상담사 통화이력 테이블로 가져오기
router.get('/callCenter/call_history', function (req, res) {
    let send_agentID = req.session.agent_id;
    let get_call_history = `SELECT 
                            client_id,
                            client_phone,
                            group_type,
                            DATE_FORMAT(connect_dt, "%y-%m-%d %H:%i:%s") AS connect_dt, 
                            DATE_FORMAT(disconnect_dt, "%y-%m-%d %H:%i:%s") AS disconnect_dt,
                            SEC_TO_TIME(TIMESTAMPDIFF(second, connect_dt, disconnect_dt)) AS call_time,
                            counsel_detail
                        FROM emo_call_info
                        WHERE agent_id = ${send_agentID} 
                        AND connect_dt > DATE_FORMAT(NOW(3), '%Y-%m-%d')
                        ORDER BY CONNECT_DT DESC 
                        LIMIT 5;`;

    //상담사 상담 이력 표
    connection.query(get_call_history, function (err, results) {
        if (err) {
            logger.error(err);
            connection.end();
        }

        res.send(results);
    });
});

// 상담사 최근 감정 표시 나타내기
router.get('/callCenter/emotion_type', function (req, res) {
    let send_emotionType = req.session.agent_id;
    let emotion_type = `SELECT emotion_type
                        FROM emo_emotion_info
                        WHERE agent_id = ${send_emotionType}
                        ORDER BY insert_dt DESC
                        LIMIT 1;`

    connection.query(emotion_type, function (err, result) {
        if (err) {
            logger.error(err);
            connection.end();
        }
        logger.info(`[최근 통화의 마지막 감정 쿼리]\n${JSON.stringify(result[0])}`);
        res.send(result);
    });
});

// 통화 중 or 통화 종료 후 고객 정보 업데이트
router.get('/callCenter/clients_details', function (req, res) {
    let client_id = req.query.client_id;
    let client_phone = req.query.client_phone;
    let counsel_detail = req.query.counsel_detail;
    let group_type = req.query.group_type;
    let callinfo_id = req.session.call_id;

    logger.info(`************************
  고객 이름: [${client_id}], 
  고객 번호: [${client_phone}], 
  상담 내용: [${counsel_detail}], 
  상담 그룹: [${group_type}]
  ************************`);

    let upt_clientInfo = `UPDATE emo_call_info 
                        SET client_id = '${client_id}', 
                          client_phone = '${client_phone}', 
                          counsel_detail = '${counsel_detail}', 
                          group_type = ${group_type} 
                        WHERE callinfo_id = '${callinfo_id}';`;

    // group_type, callinfo_id(통화시작시간)
    connection.query(upt_clientInfo, function (error, result) {
        if (error) {
            logger.error(error);
            res.json([{ callinfo_id: callinfo_id, message: "FAILED" }]);
            connection.end();
        }

        logger.info(`[상담 고객 정보 입력 쿼리]\n${upt_clientInfo}`)
        logger.info(result);
        res.json([{ callinfo_id: callinfo_id, message: "UPDATED" }]);
    })
});

// 전화 종료 시간 정보 업데이트
router.get('/restAPI/update_call_end', function (req, res) {
    logger.info('통화종료 callid 전달: ' + req.session.call_id);

    let end_call_upt = `UPDATE emo_call_info 
                      SET disconnect_dt = NOW(3) 
                      WHERE callinfo_id = '${req.session.call_id}';`;

    connection.query(end_call_upt, function (error, result, fields) {
        if (error) {
            logger.error(error);
            connection.end();
        }

        logger.info(`업데이트 쿼리 결과: ${end_call_upt}`);
        res.json([{ callinfo_id: req.session.call_id, message: "update dt ok" }]);
    })
});


//////////////// [관리자] ////////////////
//////// 상담사 감성 현황 페이지(1) ////////
router.get('/manage', function (req, res) {
    if (!req.session)
        return res.render('manage/login');

    // 금일 각 감정의 개수
    const query1 = `SELECT
                    C.emotion_type, 
                    COUNT(*) count
                  FROM emo_call_info AS A
                  INNER JOIN emo_file_info AS B
                    ON B.callinfo_id = A.callinfo_id
                  INNER JOIN emo_emotion_info AS C
                    ON C.file_name = B.file_name
                  WHERE A.connect_dt >= DATE_FORMAT(NOW(3),'%Y-%m-%d')
                  GROUP BY C.emotion_type;`;

    // 상담 그룹 별 감정의 개수
    const query2 = `SELECT
                    A.group_type,
                    C.emotion_type,
                    IFNULL(COUNT(*), 0) as count
                  FROM emo_call_info as A
                  INNER JOIN emo_file_info AS B 
                    ON B.callinfo_id = A.callinfo_id
                  INNER JOIN emo_emotion_info AS C
                    ON C.file_name = B.file_name
                  WHERE A.connect_dt >= DATE_FORMAT(NOW(3),'%Y-%m-%d')
                  GROUP BY A.group_type, C.emotion_type
                  ORDER BY A.group_type, C.emotion_type;`;

    // 1시간 단위 감성 상태 추이
    const query3 = `SELECT
                    HOUR(resreq_dt) as hour,
                    emotion_type,
                    COUNT(*) count
                  FROM emo_emotion_info
                  WHERE resreq_dt >= DATE_FORMAT(NOW(3),'%Y-%m-%d')
                  GROUP BY emotion_type, HOUR;`;

    connection.query(query1 + query2 + query3, function (error, results, fields) {
        if (error) { logger.error(error); }

        let result_count = results[0];
        let result_group = results[1];
        let every_oneHour = results[2];

        res.render('manage/main', {
            title: "상담사 감성현황",
            result_count: result_count,
            result_group: result_group,
            every_oneHour: every_oneHour
        })
    });
});

//////// 감성상태 통계분석 페이지(2) ////////
router.get('/manage/statistics', function (req, res) {
    if (!req.session)
        return res.render('manage/login');

    // 달력에서 입력받은 날짜 가져오기 위해 사용
    let theday = req.body.theday || req.query.theday;

    // 하루 5회 이상 화남을 느낀 상담사의 수 (기준: 7일전 ~ 현재)
    const query1 = `SELECT
                    COUNT(b.agent_id) AS agent_id_cnt
                  FROM
                  ( SELECT
                      a.agent_id,
                      a.emotion_cnt_2
                    FROM
                    (
                      SELECT z.connect_dt, z.agent_id, y.callinfo_id, x.emotion_type, COUNT(x.emotion_type) AS emotion_cnt, 
                              CASE WHEN COUNT(x.emotion_type) >=5 THEN 1 ELSE 0 END AS emotion_cnt_2
                      FROM emo_emotion_info x 
                      LEFT JOIN emo_file_info y
                        ON x.file_name  = y.file_name
                      LEFT JOIN emo_call_info z
                        ON y.callinfo_id = z.callinfo_id
                      WHERE x.emotion_type = '7'
                      GROUP BY z.connect_dt, z.agent_id
                    ) a
                  WHERE a.emotion_cnt >=5 AND a.connect_dt BETWEEN DATE_ADD(NOW(3), INTERVAL -7 day ) AND NOW(3)
                  GROUP BY a.agent_id
                  ) b;`;

    // 하루 5회 이상 슬픔을 느낀 상담사의 수 (기준: 7일전 ~ 현재)
    const query2 = `SELECT
                    COUNT(b.agent_id) AS agent_id_cnt
                  FROM
                  ( SELECT
                      a.agent_id,
                      a.emotion_cnt_2
                    FROM
                    (
                      SELECT z.connect_dt, z.agent_id, y.callinfo_id, x.emotion_type, COUNT(x.emotion_type) AS emotion_cnt, 
                              CASE WHEN COUNT(x.emotion_type) >=5 THEN 1 ELSE 0 END AS emotion_cnt_2
                      FROM emo_emotion_info x 
                      LEFT JOIN emo_file_info y
                        ON x.file_name  = y.file_name
                      LEFT JOIN emo_call_info z
                        ON y.callinfo_id = z.callinfo_id
                      WHERE x.emotion_type = '6'
                      GROUP BY z.connect_dt, z.agent_id
                    ) a
                  WHERE a.emotion_cnt >=5 AND a.connect_dt BETWEEN DATE_ADD(NOW(3), INTERVAL -7 day ) AND NOW(3)
                  GROUP BY a.agent_id
                  ) b;`;

    // 일일 상담사 수
    const query3 = `SELECT
                    agent_id,
                    count(callinfo_id) AS call_cnt
                  FROM emo_call_info
                  WHERE connect_dt > DATE_FORMAT(NOW(3),'%Y-%m-%d')
                  GROUP BY agent_id;`;

    // 주간 총 상담사 수
    const query4 = `SELECT
                    agent_id,
                    count(callinfo_id) AS call_cnt
                  FROM emo_call_info
                  WHERE connect_dt BETWEEN DATE_ADD(NOW(3), INTERVAL -7 day ) AND NOW(3)
                  GROUP BY agent_id;`;

    // 최근 일주간(현재시간기준) 하루 5회 이상 화남을 느낀 상담사 수(일주일 일자 표시함)하루o
    const query5 = `SELECT
                    DATE_FORMAT(x.response_dt, '%y-%m-%d') AS response_dt,
                    COUNT(y.agent_id) AS count
                  FROM
                    (
                      SELECT
                        a.date_ymd AS response_dt
                      FROM 
                        (
                        SELECT
                          CURDATE() - INTERVAL(a.a + (10 * b.a) + (100 * c.a) ) DAY as date_ymd 
                        FROM 
                          ( SELECT 0 AS a UNION ALL 
                            SELECT 1 UNION ALL 
                            SELECT 2 UNION ALL 
                            SELECT 3 UNION ALL 
                            SELECT 4 UNION ALL 
                            SELECT 5 UNION ALL 
                            SELECT 6 UNION ALL 
                            SELECT 7 UNION ALL 
                            SELECT 8 UNION ALL 
                            SELECT 9 
                          ) AS a 
                        CROSS JOIN 
                          ( SELECT 0 AS a UNION ALL 
                            SELECT 1 UNION ALL 
                            SELECT 2 UNION ALL 
                            SELECT 3 UNION ALL 
                            SELECT 4 UNION ALL 
                            SELECT 5 UNION ALL 
                            SELECT 6 UNION ALL 
                            SELECT 7 UNION ALL 
                            SELECT 8 UNION ALL 
                            SELECT 9
                          ) AS b 
                        CROSS JOIN 
                          ( SELECT 0 as a UNION ALL 
                            SELECT 1 UNION ALL 
                            SELECT 2 UNION ALL 
                            SELECT 3 UNION ALL 
                            SELECT 4 UNION ALL 
                            SELECT 5 UNION ALL 
                            SELECT 6 UNION ALL 
                            SELECT 7 UNION ALL 
                            SELECT 8 UNION ALL 
                            SELECT 9
                          ) AS c
                    ) AS a 
                    WHERE a.date_ymd BETWEEN DATE_FORMAT( DATE_SUB(NOW(3), INTERVAL 6 DAY),'%Y-%m-%d') AND DATE_FORMAT( NOW(3),'%Y-%m-%d')
                    ) x 
                  LEFT JOIN
                    (
                      SELECT
                        DATE_FORMAT(a.resreq_dt ,'%Y-%m-%d') AS RESPONSE_DT,
                        c.agent_id,
                        b.callinfo_id,
                        a.emotion_type,
                        COUNT(a.resreq_dt) AS agent_id_totcnt 
                      FROM emo_emotion_info a
                      LEFT JOIN emo_file_info b
                        ON a.file_name  = b.file_name
                      LEFT JOIN emo_call_info c
                        ON b.callinfo_id = c.callinfo_id
                      WHERE DATE_FORMAT(a.resreq_dt,'%Y%m%d') > DATE_FORMAT(DATE_SUB(NOW(3), interval 7 DAY), '%Y%m%d')
                        AND a.emotion_type = '7'
                      GROUP BY DATE_FORMAT(a.resreq_dt, '%Y%m%d'), c.agent_id
                    ) y 
                    ON x.response_dt = y.response_dt
                    AND y.agent_id_totcnt >= 5 
                  GROUP by x.response_dt;`;

    // 최근 일주간(현재시간기준) 하루 5회 이상 슬픔을 느낀 상담사 수(일주일 일자 표시함)하루o
    const query6 = `SELECT
                    DATE_FORMAT(x.response_dt, '%y-%m-%d') AS response_dt,
                    COUNT(y.agent_id) AS count
                  FROM
                    (
                      SELECT
                        a.date_ymd AS response_dt
                      FROM 
                        (
                        SELECT
                          CURDATE() - INTERVAL(a.a + (10 * b.a) + (100 * c.a) ) DAY as date_ymd 
                        FROM 
                          ( SELECT 0 AS a UNION ALL 
                            SELECT 1 UNION ALL 
                            SELECT 2 UNION ALL 
                            SELECT 3 UNION ALL 
                            SELECT 4 UNION ALL 
                            SELECT 5 UNION ALL 
                            SELECT 6 UNION ALL 
                            SELECT 7 UNION ALL 
                            SELECT 8 UNION ALL 
                            SELECT 9 
                          ) AS a 
                        CROSS JOIN 
                          ( SELECT 0 AS a UNION ALL 
                            SELECT 1 UNION ALL 
                            SELECT 2 UNION ALL 
                            SELECT 3 UNION ALL 
                            SELECT 4 UNION ALL 
                            SELECT 5 UNION ALL 
                            SELECT 6 UNION ALL 
                            SELECT 7 UNION ALL 
                            SELECT 8 UNION ALL 
                            SELECT 9
                          ) AS b 
                        CROSS JOIN 
                          ( SELECT 0 as a UNION ALL 
                            SELECT 1 UNION ALL 
                            SELECT 2 UNION ALL 
                            SELECT 3 UNION ALL 
                            SELECT 4 UNION ALL 
                            SELECT 5 UNION ALL 
                            SELECT 6 UNION ALL 
                            SELECT 7 UNION ALL 
                            SELECT 8 UNION ALL 
                            SELECT 9
                          ) AS c
                    ) AS a 
                    WHERE a.date_ymd BETWEEN DATE_FORMAT( DATE_SUB(NOW(3), INTERVAL 6 DAY),'%Y-%m-%d') AND DATE_FORMAT( NOW(3),'%Y-%m-%d')
                    ) x 
                  LEFT JOIN
                    (
                      SELECT
                        DATE_FORMAT(a.resreq_dt ,'%Y-%m-%d') AS RESPONSE_DT,
                        c.agent_id,
                        b.callinfo_id,
                        a.emotion_type,
                        COUNT(a.resreq_dt) AS agent_id_totcnt 
                      FROM emo_emotion_info a
                      LEFT JOIN emo_file_info b
                        ON a.file_name  = b.file_name
                      LEFT JOIN emo_call_info c
                        ON b.callinfo_id = c.callinfo_id
                      WHERE DATE_FORMAT(a.resreq_dt,'%Y%m%d') > DATE_FORMAT(DATE_SUB(NOW(3), interval 7 DAY), '%Y%m%d')
                        AND a.emotion_type = '6'
                      GROUP BY DATE_FORMAT(a.resreq_dt, '%Y%m%d'), c.agent_id
                    ) y 
                    ON x.response_dt = y.response_dt
                    AND y.agent_id_totcnt >= 5 
                  GROUP by x.response_dt;`;

    // 최근 일주간(현재시간기준) 하루 5회 이상 슬픔, 화남을 느낀 상담사 수(일주일 일자 표시함)하루o
    const query7 = `SELECT
                    DATE_FORMAT(x.response_dt,'%y-%m-%d') AS response_dt,
                    COUNT(y.agent_id) AS count
                  FROM
                  (
                    SELECT
                      a.date_ymd AS response_dt
                    FROM 
                    (
                      SELECT
                        CURDATE() - INTERVAL(a.a + (10 * b.a) + (100 * c.a) ) DAY AS date_ymd 
                      FROM 
                        ( 
                          SELECT 0 AS a UNION ALL 
                          SELECT 1 UNION ALL 
                          SELECT 2 UNION ALL 
                          SELECT 3 UNION ALL 
                          SELECT 4 UNION ALL 
                          SELECT 5 UNION ALL 
                          SELECT 6 UNION ALL 
                          SELECT 7 UNION ALL 
                          SELECT 8 UNION ALL 
                          SELECT 9 
                        ) AS a 
                      CROSS JOIN 
                        (
                          SELECT 0 AS a UNION ALL 
                          SELECT 1 UNION ALL 
                          SELECT 2 UNION ALL 
                          SELECT 3 UNION ALL 
                          SELECT 4 UNION ALL 
                          SELECT 5 UNION ALL 
                          SELECT 6 UNION ALL 
                          SELECT 7 UNION ALL 
                          SELECT 8 UNION ALL 
                          SELECT 9
                        ) AS b 
                      CROSS JOIN 
                        (
                          SELECT 0 as a UNION ALL 
                          SELECT 1 UNION ALL 
                          SELECT 2 UNION ALL 
                          SELECT 3 UNION ALL 
                          SELECT 4 UNION ALL 
                          SELECT 5 UNION ALL 
                          SELECT 6 UNION ALL 
                          SELECT 7 UNION ALL 
                          SELECT 8 UNION ALL 
                          SELECT 9
                        ) AS c
                    ) AS a 
                    WHERE a.date_ymd BETWEEN DATE_FORMAT(DATE_SUB(NOW(3), INTERVAL 6 DAY), '%Y-%m-%d') AND DATE_FORMAT(NOW(3), '%Y-%m-%d')
                  ) x 
                  LEFT JOIN
                  (
                    SELECT
                      DATE_FORMAT(a.resreq_dt ,'%Y-%m-%d') AS RESPONSE_DT,
                      c.agent_id,
                      b.callinfo_id,
                      a.emotion_type,
                      COUNT(a.resreq_dt) as agent_id_totcnt 
                    FROM emo_emotion_info a
                    LEFT JOIN emo_file_info b
                      ON a.file_name  = b.file_name
                    LEFT JOIN emo_call_info c
                      ON b.callinfo_id = c.callinfo_id
                    WHERE DATE_FORMAT(a.resreq_dt,'%Y%m%d') > DATE_FORMAT( DATE_SUB(NOW(3),interval 7 day ),'%Y%m%d' )
                      AND a.emotion_type = '6' AND a.emotion_type = '7'
                    GROUP BY DATE_FORMAT(a.resreq_dt,'%Y%m%d'), c.agent_id
                  ) y 
                  ON x.response_dt = y.response_dt
                  AND y.agent_id_totcnt >= 5 
                  GROUP by x.response_dt;`;

    // 평균 통화시간
    const query8 = `SELECT
                    a.group_type,
                    TRUNCATE(SUM(a.call_avg) / count(a.group_type),0) AS call_avg
                  FROM
                    (SELECT
                      DATE_FORMAT(connect_dt,'%Y-%m-%d') AS connect_dt,
                      group_type,
                      TIMESTAMPDIFF(SECOND, connect_dt, disconnect_dt) AS call_avg
                    FROM emo_call_info 
                    WHERE CONNECT_DT BETWEEN DATE_ADD(NOW(3), INTERVAL -1 WEEK) AND NOW(3)) a 
                  GROUP BY a.group_type 
                  ORDER BY a.group_type;`;

    // 그룹 별 일주일간 통화 건수 (1:일반문의 / 2:민원접수 / 3:제품판매 / 4:기타문의)
    const query9 = `SELECT
                    a.group_type,
                    COUNT(callinfo_id) AS call_cnt
                  FROM
                    (SELECT 
                      DATE_FORMAT(connect_dt,'%Y-%m-%d') AS connect_dt,
                      group_type,
                      callinfo_id 
                    FROM emo_call_info 
                    WHERE CONNECT_DT BETWEEN DATE_ADD(NOW(3), INTERVAL -1 WEEK) AND NOW(3)
                    ) a
                  GROUP BY a.group_type 
                  ORDER BY a.group_type;`;

    // 화남, 슬픔 모두 5회 이상 느낀 상담사 수
    const query10 = `SELECT
                    COUNT(b.agent_id) AS agent_id_cnt
                  FROM
                  ( SELECT
                      a.agent_id,
                      a.emotion_cnt_2
                    FROM
                    (
                      SELECT z.connect_dt, z.agent_id, y.callinfo_id, x.emotion_type, COUNT(x.emotion_type) AS emotion_cnt, 
                              CASE WHEN COUNT(x.emotion_type) >=5 THEN 1 ELSE 0 END AS emotion_cnt_2
                      FROM emo_emotion_info x 
                      LEFT JOIN emo_file_info y
                        ON x.file_name  = y.file_name
                      LEFT JOIN emo_call_info z
                        ON y.callinfo_id = z.callinfo_id
                      WHERE x.emotion_type = '6' AND x.emotion_type = '7'
                      GROUP BY z.connect_dt, z.agent_id
                    ) a
                  WHERE a.emotion_cnt >=5 AND a.connect_dt BETWEEN DATE_ADD(NOW(3), INTERVAL -7 day ) AND NOW(3)
                  GROUP BY a.agent_id
                  ) b;`;

    // 기쁨, 평온 각각 5회 이상 느낀 상담사 수
    const query11 = `SELECT
                    COUNT(b.agent_id) AS agent_id_cnt
                  FROM
                  ( SELECT
                      a.agent_id,
                      a.emotion_cnt_2
                    FROM
                    (
                      SELECT z.connect_dt, z.agent_id, y.callinfo_id, x.emotion_type, COUNT(x.emotion_type) AS emotion_cnt, 
                              CASE WHEN COUNT(x.emotion_type) >=5 THEN 1 ELSE 0 END AS emotion_cnt_2
                      FROM emo_emotion_info x 
                      LEFT JOIN emo_file_info y
                        ON x.file_name  = y.file_name
                      LEFT JOIN emo_call_info z
                        ON y.callinfo_id = z.callinfo_id
                      WHERE x.emotion_type = '5' AND x.emotion_type = '10'
                      GROUP BY z.connect_dt, z.agent_id
                    ) a
                  WHERE a.emotion_cnt >=5 AND a.connect_dt BETWEEN DATE_ADD(NOW(3), INTERVAL -7 day ) AND NOW(3)
                  GROUP BY a.agent_id
                  ) b;`;

    // 그룹 별 일주일 간 상담사 수(그룹 별 5회이상 감정(화남)을 느낀 상담사 수)
    const query12 = `SELECT 
                    group_type, 
                    SUM(emotion_cnt_2) AS emotion_cnt_2 
                  FROM
                    (
                    SELECT 
                      group_type, 
                      emotion_cnt_2, 
                      DATE_FORMAT(connect_dt,'%Y-%m-%d') AS connect_dt
                    FROM
                      (
                      SELECT
                        (SELECT agent_id 
                        FROM emo_call_info z 
                        WHERE z.callinfo_id = x.callinfo_id ) AS agent_id,
                        (SELECT group_type 
                        FROM emo_call_info z 
                        WHERE z.callinfo_id = x.callinfo_id ) AS group_type,
                        (SELECT connect_dt AS connect_dt 
                        FROM emo_call_info z 
                        WHERE z.callinfo_id = x.callinfo_id ) AS connect_dt,
                        emotion_type,
                        COUNT(emotion_type) AS emotion_cnt,
                        CASE WHEN count(emotion_type) >= 5 THEN 1 
                        ELSE 0 END AS emotion_cnt_2
                      FROM emo_file_info x
                      LEFT JOIN emo_emotion_info a
                      ON x.file_name = a.file_name
                      WHERE a.emotion_type = '7' 
                      GROUP BY x.agent_id 
                      ) y 
                    WHERE y.emotion_cnt >= 5 AND connect_dt BETWEEN DATE_ADD(NOW(3), INTERVAL -1 WEEK) AND NOW(3) 
                    GROUP BY y.group_type, y.connect_dt 
                    ) z 
                  GROUP BY z.group_type;`;

    // 그룹 별 일주일간 상담사 수(그룹별로 5회이상 슬픔 느낀 상담사 수 출력)
    const query13 = `SELECT 
                    group_type, 
                    SUM(emotion_cnt_2) AS emotion_cnt_2 
                  FROM
                    (
                    SELECT 
                      group_type, 
                      emotion_cnt_2, 
                      DATE_FORMAT(connect_dt,'%Y-%m-%d') AS connect_dt
                    FROM
                      (
                      SELECT
                        (SELECT agent_id 
                        FROM emo_call_info z 
                        WHERE z.callinfo_id = x.callinfo_id ) AS agent_id,
                        (SELECT group_type 
                        FROM emo_call_info z 
                        WHERE z.callinfo_id = x.callinfo_id ) AS group_type,
                        (SELECT connect_dt AS connect_dt 
                        FROM emo_call_info z 
                        WHERE z.callinfo_id = x.callinfo_id ) AS connect_dt,
                        emotion_type,
                        COUNT(emotion_type) AS emotion_cnt,
                        CASE WHEN count(emotion_type) >= 5 THEN 1 
                        ELSE 0 END AS emotion_cnt_2
                      FROM emo_file_info x
                      LEFT JOIN emo_emotion_info a
                      ON x.file_name = a.file_name
                      WHERE a.emotion_type = '6' 
                      GROUP BY x.agent_id 
                      ) y 
                    WHERE y.emotion_cnt >= 5 AND connect_dt BETWEEN DATE_ADD(NOW(3), INTERVAL -1 WEEK) AND NOW(3) 
                    GROUP BY y.group_type, y.connect_dt 
                    ) z 
                  GROUP BY z.group_type;`;

    // 그룹 별 일주일간 상담사 수(그룹별로 5회이상 화남, 슬픔 동시에 느낀 상담사 수 출력)
    const query14 = `SELECT 
                    group_type, 
                    SUM(emotion_cnt_2) AS emotion_cnt_2 
                  FROM
                    (
                    SELECT 
                      group_type, 
                      emotion_cnt_2, 
                      DATE_FORMAT(connect_dt,'%Y-%m-%d') AS connect_dt
                    FROM
                      (
                      SELECT
                        (SELECT agent_id 
                        FROM emo_call_info z 
                        WHERE z.callinfo_id = x.callinfo_id ) AS agent_id,
                        (SELECT group_type 
                        FROM emo_call_info z 
                        WHERE z.callinfo_id = x.callinfo_id ) AS group_type,
                        (SELECT connect_dt AS connect_dt 
                        FROM emo_call_info z 
                        WHERE z.callinfo_id = x.callinfo_id ) AS connect_dt,
                        emotion_type,
                        COUNT(emotion_type) AS emotion_cnt,
                        CASE WHEN count(emotion_type) >= 5 THEN 1 
                        ELSE 0 END AS emotion_cnt_2
                      FROM emo_file_info x
                      LEFT JOIN emo_emotion_info a
                      ON x.file_name = a.file_name
                      WHERE a.emotion_type = '7' AND a.emotion_type = '6'
                      GROUP BY x.agent_id 
                      ) y 
                    WHERE y.emotion_cnt >= 5 AND connect_dt BETWEEN DATE_ADD(NOW(3), INTERVAL -1 WEEK) AND NOW(3) 
                    GROUP BY y.group_type, y.connect_dt 
                    ) z 
                  GROUP BY z.group_type;`;

    connection.query(query1 + query2 + query3 + query4 + query5 + query6 + query7 +
        query8 + query9 + query10 + query11 + query12 + query13 + query14, [theday, theday],
        function (error, results, fields) {
            if (error) { logger.error(error); }

            let angry_count = results[0];
            let panic_count = results[1];
            let day_count = results[2];
            let week_count = results[3];
            let day_5countAngry = results[4];
            let day_5countSad = results[5];
            let day_5countBoth = results[6];
            let call_avg = results[7];
            let call_cnt = results[8];
            let ap_count = results[9];
            let hp_count = results[10];
            let angryg_count = results[11];
            let panicg_count = results[12];
            let apg_count = results[13];

            res.render('manage/statistics', {
                title: "감성상태 통계분석",
                angry_count: angry_count,
                panic_count: panic_count,
                day_count: day_count,
                week_count: week_count,
                day_5countAngry: day_5countAngry,
                day_5countSad: day_5countSad,
                day_5countBoth: day_5countBoth,
                call_avg: call_avg,
                call_cnt: call_cnt,
                ap_count: ap_count,
                hp_count: hp_count,
                angryg_count: angryg_count,
                panicg_count: panicg_count,
                apg_count: apg_count
            });
        });
});

//////// 상담사 통화이력 페이지(3) ////////
router.get('/manage/monitoring', function (req, res) {
    if (!req.session) {
        return res.render('manage/login');
    }

    let select_group = req.query.select_group;
    let select_emo = req.query.select_emo;
    let select_agent = req.query.select_agent;

    if (select_group == undefined || select_group == "") { select_group = '5'; }
    if (select_agent == undefined || select_agent == "") { select_agent = '전체'; }
    if (select_emo == undefined || select_emo == "") { select_emo = '5'; }

    logger.info(`전달 받은 데이터: 그룹(${select_group}), 상담사(${select_agent}), 감정상태(${select_emo})`);

    let monitor_query1 = `SELECT 
                        a.agent_id,
                        a.group_type,
                        a.connect_dt,
                        b.interface_dt,
                        c.resreq_dt,
                        a.disconnect_dt,
                        c.emotion_type
                      FROM emo_call_info a 
                      LEFT JOIN emo_transmit_info b 
                        ON a.callinfo_id = b.callinfo_id
                      LEFT JOIN emo_emotion_info c
                        ON b.file_name = c.file_name
                      LEFT JOIN emo_agent_info d
                        ON a.agent_id = d.agent_id
                      WHERE a.connect_dt > DATE_FORMAT(NOW(3),'%Y-%m-%d')`;

    if (select_group != '5') { monitor_query1 = monitor_query1 + ` AND a.group_type in ('${select_group}') `; }
    if (select_agent != '전체') { monitor_query1 = monitor_query1 + ` AND a.agent_id in ('${select_agent}') `; }
    if (select_emo != '5') { monitor_query1 = monitor_query1 + ` AND c.emotion_type in ('${select_emo}' ) `; }
    monitor_query1 = monitor_query1 + ` ORDER BY connect_dt DESC;`

    //상담사 상담 이력 표
    const monitor_query2 = `SELECT
                            agent_id,
                            group_type,
                            connect_dt,
                            disconnect_dt,
                            SEC_TO_TIME(TIMESTAMPDIFF(second, connect_dt, disconnect_dt)) AS call_time
                          FROM emo_call_info
                          WHERE connect_dt > DATE_FORMAT(NOW(3),'%Y-%m-%d')
                          ORDER BY connect_dt DESC;`;

    // 상담사 이름(SELECT BOX 용)
    const monitor_query3 = `SELECT agent_id, agent_name FROM emo_agent_info;`;

    // 감성 판단 결과
    const monitor_query4 = `SELECT type_no FROM emo_code_info
                          WHERE type_detail IN ('happy', 'peace', 'sadness', 'anger');`

    connection.query(monitor_query1 + monitor_query2 + monitor_query3 + monitor_query4, function (err, results) {
        if (err) {
            logger.error(err);
            connection.end();
        }
        logger.info('[monitor_query1 성공]\n' + monitor_query1);

        let emotion_table = results[0];
        let call_table = results[1];
        let agent_name = results[2];
        let emo_type = results[3];

        res.render('manage/monitoring', {
            title: "상담사 통화이력",
            emotion_table: emotion_table,
            call_table: call_table,
            moment: moment,
            agent_name: agent_name,
            emo_type: emo_type
        });
    });
});

//////// 상담사 개인 통화이력 페이지(3-1) ////////
router.get('/manage/230811_statistics', function (req, res) {
  if (!req.session) {
    return res.render('manage/login');
  }

  // 금일 각 감정의 개수
  const query1 = `SELECT
                    C.emotion_type, 
                    COUNT(*) count
                  FROM emo_call_info AS A
                  INNER JOIN emo_file_info AS B
                    ON B.callinfo_id = A.callinfo_id
                  INNER JOIN emo_emotion_info AS C
                    ON C.file_name = B.file_name
                  WHERE A.connect_dt >= DATE_FORMAT(NOW(3),'%Y-%m-%d')
                  GROUP BY C.emotion_type;`;

  // 상담 그룹 별 감정의 개수
  const query2 = `SELECT
                    A.group_type,
                    C.emotion_type,
                    IFNULL(COUNT(*), 0) as count
                  FROM emo_call_info as A
                  INNER JOIN emo_file_info AS B 
                    ON B.callinfo_id = A.callinfo_id
                  INNER JOIN emo_emotion_info AS C
                    ON C.file_name = B.file_name
                  WHERE A.connect_dt >= DATE_FORMAT(NOW(3),'%Y-%m-%d')
                  GROUP BY A.group_type, C.emotion_type
                  ORDER BY A.group_type, C.emotion_type;`;

  // 1시간 단위 감성 상태 추이
  // const query3 = `SELECT
  //                   HOUR(resreq_dt) as hour,
  //                   emotion_type,
  //                   COUNT(*) count
  //                 FROM emo_emotion_info
  //                 WHERE resreq_dt >= DATE_FORMAT(NOW(3),'%Y-%m-%d')
  //                 GROUP BY emotion_type, HOUR;`;

  connection.query(query1 + query2, function (error, results, fields) {
    if (error) { logger.error(error); }

    let result_count = results[0];
    let result_group = results[1];

    res.render('manage/230811_statistics', {
      title: "상담사 개인 통화이력",
      result_count: result_count,
      result_group: result_group
    });
  });
});

//////// 상담사 전체 감성 현황 페이지(3-2) ////////
router.get('/manage/230811_dashboard', function (req, res) {
  if (!req.session) {
    return res.render('manage/login');
  }

  res.render('manage/230811_dashboard', {
    title: "상담사 전체 감성현황",
    moment: moment
  });
});

//////// 상담사 시간 구간내의 감정 표현 (4) ////////
router.get(`/manage/monitoring_emo`, function (req, res) {
    if (!req.session) {
        return res.render('manage/login');
    }
    let dateTime;
    let emograph_query;

    if (req.query.autoDate) {
        logger.info(`자동조회 요청 들어옴`);
        dateTime = req.query.autoDate;

        // 최종 날짜시간 조건 확인
        logger.info(`현재시간: ${dateTime}`);

        emograph_query = `SELECT
                        DATE_FORMAT(x.response_dt, '%Y%m%d%H%i%s') AS response_dt,
                        IFNULL(y.emotion_type, 0) AS emotion_type,
                        CASE 
                          WHEN y.emotion_type IS NULL THEN 0
                          ELSE IFNULL(x.agent_status, 0) 
                        END AS agent_status
                      FROM
                      (
                      SELECT
                      a.date_ymd AS response_dt,
                      (
                      SELECT 1 FROM emo_call_info z
                      WHERE DATE_FORMAT(z.connect_dt,'%Y%m%d%H%i%s') <= a.date_ymd
                      AND z.disconnect_dt IS NULL
                      AND z.agent_id IN (1, 2, 3)
                      UNION
                      SELECT 1 FROM emo_call_info z
                      WHERE DATE_FORMAT(z.connect_dt, '%Y%m%d%H%i%s') <= a.date_ymd
                      AND DATE_FORMAT(z.disconnect_dt,'%Y%m%d%H%i%s') >= a.date_ymd
                      AND z.agent_id IN (1, 2, 3)
                      ) AS agent_status
                      FROM
                      (
                      SELECT
                        NOW() - INTERVAL(a.a + (10 * b.a) + (100 * c.a)) SECOND AS date_ymd
                      FROM
                      ( SELECT 0 AS a UNION ALL
                      SELECT 1 UNION ALL
                      SELECT 2 UNION ALL
                      SELECT 3 UNION ALL
                      SELECT 4 UNION ALL
                      SELECT 5 UNION ALL
                      SELECT 6 UNION ALL
                      SELECT 7 UNION ALL
                      SELECT 8 UNION ALL
                      SELECT 9
                      ) AS a
                      CROSS JOIN
                      ( SELECT 0 AS a UNION ALL
                      SELECT 1 UNION ALL
                      SELECT 2 UNION ALL
                      SELECT 3 UNION ALL
                      SELECT 4 UNION ALL
                      SELECT 5 UNION ALL
                      SELECT 6 UNION ALL
                      SELECT 7 UNION ALL
                      SELECT 8 UNION ALL
                      SELECT 9
                      ) AS b
                      CROSS JOIN
                      ( SELECT 0 as a UNION ALL
                      SELECT 1 UNION ALL
                      SELECT 2 UNION ALL
                      SELECT 3 UNION ALL
                      SELECT 4 UNION ALL
                      SELECT 5 UNION ALL
                      SELECT 6 UNION ALL
                      SELECT 7 UNION ALL
                      SELECT 8 UNION ALL
                      SELECT 9
                      ) AS c
                      ) AS a
                      WHERE a.date_ymd > DATE_SUB(STR_TO_DATE(DATE_FORMAT(NOW(),'%Y%m%d%H%i%s'),'%Y%m%d%H%i%s'), INTERVAL 10 MINUTE)
                      AND MOD(DATE_FORMAT(a.date_ymd, '%s'), 3) = 0
                      ) x LEFT JOIN
                      (
                      SELECT
                      CONCAT(DATE_FORMAT(b.file_save_dt,'%Y%m%d%H%i'), LPAD(DATE_FORMAT(b.file_save_dt, '%s') - MOD(DATE_FORMAT(b.file_save_dt, '%s'),3),'2','0' )) as file_save_dt,
                      b.file_name,
                      b.agent_id,
                      a.emotion_type
                      FROM emo_emotion_info a
                      LEFT JOIN emo_file_info b
                      ON a.file_name = b.file_name
                      AND a.agent_id = b.agent_id
                      WHERE b.agent_id IN (1, 2, 3)
                      AND b.file_save_dt >= DATE_SUB(STR_TO_DATE(DATE_FORMAT(NOW(),'%Y%m%d%H%i%s'),'%Y%m%d%H%i%s'), INTERVAL 10 MINUTE)
                      ) y
                      ON x.response_dt = y.file_save_dt
                      ORDER BY x.response_dt;`;
    } else {
        logger.info('수동조회 요청 들어옴');
        // 넘어온 날짜, 시간 값 전처리
        let select_date = req.query.select_date;
        select_date = select_date.replace(/-/g, "");

        let select_time = req.query.select_time;

        if (select_time.includes('PM') == true) {
            select_time = select_time.replace(/PM/gi, "");
            select_time = select_time.replace(/:/g, "").trim();
        } else if (select_time.includes('AM') == true) {
            select_time = select_time.replace(/AM/gi, "");
            select_time = select_time.replace(/:/g, "").trim();
        }

        dateTime = select_date + select_time + '00';
        // 최종 날짜시간 조건 확인
        logger.info(`날짜시간: ${dateTime}`);

        // 상담사 감성상태 그래프 (시간, 감정 종류, 상담사 상태)
        // emograph_query = `SELECT
        //                     DATE_FORMAT(x.response_dt, '%Y%m%d%H%i%s') AS response_dt,
        //                     IFNULL(y.emotion_type, 0) AS emotion_type,
        //                     CASE 
        //                       WHEN y.emotion_type IS NULL THEN 0
        //                         ELSE IFNULL(x.agent_status, 0) 
        //                     END AS agent_status
        //                   FROM
        //                   (
        //                     SELECT
        //                       a.date_ymd AS response_dt,
        //                       (
        //                         SELECT 1 FROM emo_call_info z
        //                         WHERE DATE_FORMAT(z.connect_dt,'%Y%m%d%H%i%s') <= a.date_ymd
        //                         AND z.disconnect_dt IS NULL
        //                         AND z.agent_id IN (1, 2, 3)
        //                         UNION
        //                         SELECT 1 FROM emo_call_info z
        //                         WHERE DATE_FORMAT(z.connect_dt, '%Y%m%d%H%i%s') <= a.date_ymd
        //                         AND DATE_FORMAT(z.disconnect_dt,'%Y%m%d%H%i%s') >= a.date_ymd
        //                         AND z.agent_id IN (1, 2, 3)
        //                       ) AS agent_status
        //                     FROM
        //                     (
        //                       SELECT
        //                         DATE_ADD(STR_TO_DATE('${dateTime}', '%Y%m%d%H%i%s'), INTERVAL 10 MINUTE) - INTERVAL(a.a + (10 * b.a) + (100 * c.a)) SECOND AS date_ymd
        //                       FROM
        //                         ( SELECT 0 AS a UNION ALL
        //                         SELECT 1 UNION ALL
        //                         SELECT 2 UNION ALL
        //                         SELECT 3 UNION ALL
        //                         SELECT 4 UNION ALL
        //                         SELECT 5 UNION ALL
        //                         SELECT 6 UNION ALL
        //                         SELECT 7 UNION ALL
        //                         SELECT 8 UNION ALL
        //                         SELECT 9
        //                         ) AS a
        //                         CROSS JOIN
        //                         ( SELECT 0 AS a UNION ALL
        //                         SELECT 1 UNION ALL
        //                         SELECT 2 UNION ALL
        //                         SELECT 3 UNION ALL
        //                         SELECT 4 UNION ALL
        //                         SELECT 5 UNION ALL
        //                         SELECT 6 UNION ALL
        //                         SELECT 7 UNION ALL
        //                         SELECT 8 UNION ALL
        //                         SELECT 9
        //                         ) AS b
        //                         CROSS JOIN
        //                         ( SELECT 0 as a UNION ALL
        //                         SELECT 1 UNION ALL
        //                         SELECT 2 UNION ALL
        //                         SELECT 3 UNION ALL
        //                         SELECT 4 UNION ALL
        //                         SELECT 5 UNION ALL
        //                         SELECT 6 UNION ALL
        //                         SELECT 7 UNION ALL
        //                         SELECT 8 UNION ALL
        //                         SELECT 9
        //                         ) AS c
        //                     ) AS a
        //                   WHERE a.date_ymd BETWEEN STR_TO_DATE('${dateTime}', '%Y%m%d%H%i%s')
        //                     AND DATE_ADD(STR_TO_DATE('${dateTime}', '%Y%m%d%H%i%s'), INTERVAL 10 MINUTE)
        //                     AND MOD(DATE_FORMAT(a.date_ymd, '%s'),3) = 0
        //                   ) x LEFT JOIN
        //                     (
        //                     SELECT
        //                       CONCAT(DATE_FORMAT(b.file_save_dt,'%Y%m%d%H%i'), LPAD(DATE_FORMAT(b.file_save_dt, '%s') - MOD(DATE_FORMAT(b.file_save_dt, '%s'),3),'2','0' )) as file_save_dt,
        //                       b.file_name,
        //                       b.agent_id,
        //                       a.emotion_type
        //                     FROM emo_emotion_info a
        //                     LEFT JOIN emo_file_info b
        //                       ON a.file_name = b.file_name
        //                     AND a.agent_id = b.agent_id
        //                     WHERE b.agent_id IN (1, 2, 3)
        //                     AND b.file_save_dt > STR_TO_DATE('${dateTime}', '%Y%m%d%H%i%s')
        //                     AND b.file_save_dt <= DATE_ADD(STR_TO_DATE('${dateTime}', '%Y%m%d%H%i%s'), INTERVAL 10 MINUTE)
        //                     ) y
        //                   ON x.response_dt = y.file_save_dt
        //                   ORDER BY x.response_dt;`;

        emograph_query = `SELECT
                        DATE_FORMAT(x.response_dt, '%Y%m%d%H%i%s') AS response_dt,
                        IFNULL(y.emotion_type, 0) AS emotion_type,
                        CASE 
                          WHEN y.emotion_type IS NULL THEN 0
                          ELSE IFNULL(x.agent_status, 0) 
                        END AS agent_status
                      FROM
                      (
                      SELECT
                        a.date_ymd AS response_dt,
                      (
                      SELECT 1 FROM emo_call_info z
                      WHERE DATE_FORMAT(z.connect_dt,'%Y%m%d%H%i%s') <= a.date_ymd
                      AND z.disconnect_dt IS NULL
                      AND z.agent_id IN (1, 2, 3)
                      UNION
                      SELECT 1 FROM emo_call_info z
                      WHERE DATE_FORMAT(z.connect_dt, '%Y%m%d%H%i%s') <= a.date_ymd
                      AND DATE_FORMAT(z.disconnect_dt,'%Y%m%d%H%i%s') >= a.date_ymd
                      AND z.agent_id IN (1, 2, 3)
                      ) AS agent_status
                      FROM
                      (
                      SELECT
                        STR_TO_DATE('${dateTime}', '%Y%m%d%H%i%s') - INTERVAL(a.a + (10 * b.a) + (100 * c.a)) SECOND AS date_ymd
                      FROM
                      ( SELECT 0 AS a UNION ALL
                      SELECT 1 UNION ALL
                      SELECT 2 UNION ALL
                      SELECT 3 UNION ALL
                      SELECT 4 UNION ALL
                      SELECT 5 UNION ALL
                      SELECT 6 UNION ALL
                      SELECT 7 UNION ALL
                      SELECT 8 UNION ALL
                      SELECT 9
                      ) AS a
                      CROSS JOIN
                      ( SELECT 0 AS a UNION ALL
                      SELECT 1 UNION ALL
                      SELECT 2 UNION ALL
                      SELECT 3 UNION ALL
                      SELECT 4 UNION ALL
                      SELECT 5 UNION ALL
                      SELECT 6 UNION ALL
                      SELECT 7 UNION ALL
                      SELECT 8 UNION ALL
                      SELECT 9
                      ) AS b
                      CROSS JOIN
                      ( SELECT 0 as a UNION ALL
                      SELECT 1 UNION ALL
                      SELECT 2 UNION ALL
                      SELECT 3 UNION ALL
                      SELECT 4 UNION ALL
                      SELECT 5 UNION ALL
                      SELECT 6 UNION ALL
                      SELECT 7 UNION ALL
                      SELECT 8 UNION ALL
                      SELECT 9
                      ) AS c
                      ) AS a
                      WHERE a.date_ymd > DATE_SUB(STR_TO_DATE('${dateTime}','%Y%m%d%H%i%s'), INTERVAL 10 MINUTE)
                      AND MOD(DATE_FORMAT(a.date_ymd, '%s'), 3) = 0
                      ) x LEFT JOIN
                      (
                      SELECT
                      CONCAT(DATE_FORMAT(b.file_save_dt,'%Y%m%d%H%i'), LPAD(DATE_FORMAT(b.file_save_dt, '%s') - MOD(DATE_FORMAT(b.file_save_dt, '%s'),3),'2','0' )) as file_save_dt,
                      b.file_name,
                      b.agent_id,
                      a.emotion_type
                      FROM emo_emotion_info a
                      LEFT JOIN emo_file_info b
                      ON a.file_name = b.file_name
                      AND a.agent_id = b.agent_id
                      WHERE b.agent_id IN (1, 2, 3)
                      AND b.file_save_dt >= DATE_SUB(STR_TO_DATE('${dateTime}','%Y%m%d%H%i%s'), INTERVAL 10 MINUTE)
                      ) y
                      ON x.response_dt = y.file_save_dt
                      ORDER BY x.response_dt;`;
    }

    connection.query(emograph_query, function (err, results, fields) {
        if (err) {
            logger.info(err);
            connection.end();
        }
        logger.info(`[감정그래프 쿼리 결과]\n${emograph_query}`);

        // 결과 값 전체를 보냄
        res.send(results);
    });
});

//////// 상담사 코칭 페이지(5) ////////
router.get('/manage/counseling', function (req, res) {
    if (!req.session) { return res.render('manage/login'); }

    let history_today = getYearMonthDay();
    history_today = history_today.substring(0, 4) + '-' + history_today.substring(5, 7) + '-' + history_today.slice(-2);

    // 1. 자동 코칭 조건 테이블 조회
    const counsel_query1 = `SELECT * FROM emo_counsel_con WHERE del_yn != 'Y';`;

    // 2. 수동 코칭 조건 테이블 조회(30초)
    const counsel_query2 = `SELECT 
                            x.sum_dt
                            ,x.call_date
                            ,x.call_time
                            ,x.call_timeStan
                            ,x.agent_name
                            ,x.auto_standard
                            ,x.agent_sad
                            ,x.auto_over_sad
                            ,x.agent_anger                                           
                            ,x.auto_over_anger  
                            ,ifnull(y.call_count,0) AS call_count
                          FROM
                          (
                            SELECT
                              CONCAT(DATE_FORMAT(a.call_date, '%Y%m%d'), a.call_time) AS sum_dt,
                              DATE_FORMAT(a.call_date, '%Y%m%d') AS call_date,
                              STR_TO_DATE(a.call_time, '%H%i%S') AS call_time,
                              ADDTIME(a.call_time, a.auto_standard) AS call_timeStan,
                              (
                                SELECT MAX(b.agent_name) 
                                FROM emo_agent_info b 
                                WHERE b.agent_id = a.agent_id
                              ) AS agent_name,
                              a.auto_standard,
                              a.agent_sad,
                              a.auto_over_sad,
                              a.agent_anger,                                            
                              a.auto_over_anger                                       
                            FROM emo_coaching_message a 
                            WHERE a.auto_coach = 'P'
                            AND a.agent_id IN(1, 2)
                            AND a.call_date = DATE_FORMAT('${getYearMonthDay()}', '%Y%m%d')
                            AND send_yn = 'N'
                          ) AS x
                        LEFT JOIN
                          (
                            SELECT 
                              CONCAT(DATE_FORMAT(call_date, '%Y%m%d'), LEFT(call_time, 4), '00') AS sum_dt,
                              DATE_FORMAT(MAX(call_date), '%Y%m%d') AS call_date,
                              CONCAT(LEFT(MAX(call_time), 4), '00') AS call_time,
                              agent_id,
                              SUM(call_count) AS call_count
                            FROM emo_call_count
                            WHERE
                              call_date = DATE_FORMAT('${getYearMonthDay()}', '%Y%m%d')
                              AND RIGHT(call_time, 2) IN(00, 10, 20)
                            GROUP BY 
                              CONCAT(DATE_FORMAT(call_date, '%Y%m%d'), LEFT(call_time, 4), '00'), 
                              agent_id     
                            UNION
                            SELECT 
                              CONCAT(DATE_FORMAT(call_date, '%Y%m%d'), LEFT(call_time, 4), '30') AS sum_dt,
                              DATE_FORMAT(MAX(call_date), '%Y%m%d') AS call_date,
                              CONCAT(LEFT(MAX(call_time), 4), '30') AS call_time,
                              agent_id,
                              SUM(call_count) AS call_count
                            FROM emo_call_count
                            WHERE 
                              call_date = DATE_FORMAT('${getYearMonthDay()}', '%Y%m%d')
                              AND RIGHT(call_time, 2) IN(30, 40, 50)
                            GROUP BY 
                              CONCAT(DATE_FORMAT(call_date, '%Y%m%d'), left(call_time, 4), '30'), 
                              agent_id
                          ) AS y
                        ON x.sum_dt = y.sum_dt;`;

    // 3. 수동 코칭 상담사 이름 가져오기기
    const counsel_query3 = `SELECT agent_name
                          FROM emo_agent_info
                          WHERE user_type = 1
                          AND org_name = 'neighbor system'
                          ORDER BY agent_id;`;

    // 4. 코칭 이력 테이블 조회
    const counsel_query4 = ` SELECT 
                             a.agent_id,
                             a.agent_name,
                             b.auto_coach,
                             b.auto_standard,
                             b.auto_detail,
                             b.pass_etc
                           FROM emo_agent_info a
                           LEFT JOIN emo_coaching_message b
                             ON b.agent_id = a.agent_id
                           WHERE a.agent_id IN(1, 2)
                             AND b.send_yn = 'Y'
                             AND b.auto_coach IN('A', 'P')
                             AND b.call_date = CURDATE();`;

    connection.query(counsel_query1 + counsel_query2 + counsel_query3 + counsel_query4, function (error, results) {
        if (error) {
            logger.error(error);
            connection.end();
        }
        logger.info(`[수동 코칭 조건 전송예약 쿼리 결과]\n${counsel_query2}`);
        logger.info(`[코칭 이력 테이블 조회 쿼리 결과]\n${counsel_query4}`);

        let condition_set = results[0];
        let condition_passive = results[1];
        let agent_name = results[2];
        let counsel_history = results[3];

        logger.info(`counsel_history.length: ${JSON.stringify(counsel_history)}`);

        res.render('manage/counseling', {
            title: "상담사 코칭",
            condition_set: condition_set,
            condition_passive: condition_passive,
            agent_name: agent_name,
            counsel_history: counsel_history
        });
    });
});

//////// 상담사 코칭 조건 등록 페이지(6) ////////
router.get('/manage/counseling_manage', function (req, res) {
    if (!req.session)
        return res.render('manage/login');

    res.render('manage/counseling_manage', {
        title: "코칭 조건 세부 설정"
    });
});

//////// 상담사 코칭 조건 등록 (6-1) ////////
router.get('/manage/counseling_submit', function (req, res) {
    let use_unuse = req.query.useUnuse;
    let standard_time = req.query.standardTime;
    let over_anger = req.query.overAnger;
    let over_sadness = req.query.overSadness;
    let autoCounsel_use = req.query.autoCounsel_use;
    let autoCounsel_detail = req.query.autoCounsel_detail;

    logger.info(`사용여부: ${use_unuse} 기준시간: ${standard_time} 화남초과: ${over_anger}, 슬픔초과: ${over_sadness} 자동사용여부: ${autoCounsel_use} 자동메세지내용: ${autoCounsel_detail}`);

    if (use_unuse == 1) { use_unuse = 'Y'; }
    else { use_unuse = 'N'; }

    if (autoCounsel_use == 1) { autoCounsel_use = 'A'; }
    else { autoCounsel_use = 'P'; }

    let counsel_query = `INSERT INTO emo_counsel_con (use_unuse, standard, over_anger, over_sad, auto_coach, auto_detail, auto_insert_dt, auto_update_dt, del_yn) 
                      VALUES ('${use_unuse}', ${standard_time}, ${over_anger}, ${over_sadness}, '${autoCounsel_use}', '${autoCounsel_detail}', NOW(3), null, 'N');`;
    logger.info(counsel_query);

    // emo_counsel_con(코칭 조건 설정) 테이블에 INSERT
    connection.query(counsel_query, function (error, result) {
        if (error) {
            logger.error(error);
            connection.end();
        }
        logger.info(`행 삽입 성공\n${counsel_query}`);

        res.send(result);
    });
});

//////// 상담사 코칭 조건 수정 (7) ////////
router.get('/manage/counseling_edit', function (req, res) {
    if (!req.session) return res.render('manage/login');

    // AJAX를 통해 수정하려는 값 전달받기
    let auto_seq = req.query.autoSeq;
    let use_unuse = req.query.useUnuse;
    let standard_min = req.query.standardMin;
    let over_agner = req.query.overAgner;
    let over_sad = req.query.overSad;
    let auto_coach = req.query.autoCoach;
    let auto_detail = req.query.autoDetail;


    logger.info(`*********************`);
    logger.info(`번호       : ${auto_seq}`);
    logger.info(`사용 여부  : ${use_unuse}`);
    logger.info(`기준 시간  : ${standard_min}`);
    logger.info(`초과 화남  : ${over_agner}`);
    logger.info(`초과 슬픔  : ${over_sad}`);
    logger.info(`코칭 분류  : ${auto_coach}`);
    logger.info(`코칭 메세지: ${auto_detail}`);
    logger.info(`*********************`);

    if (use_unuse == 1) {
        use_unuse = 'Y'
    } else {
        use_unuse = 'N'
    }

    if (standard_min == 1) {
        standard_min = 10;
    } else if (standard_min == 2) {
        standard_min = 30;
    } else {
        standard_min = 60;
    }

    if (auto_coach == '1') {
        auto_coach = 'A'
    } else { auto_coach = 'P' }

    let upt_query = `UPDATE emo_counsel_con
                  SET use_unuse = '${use_unuse}',
                      standard = ${standard_min},
                      over_anger = ${over_agner},
                      over_sad = ${over_sad},
                      auto_coach = '${auto_coach}', 
                      auto_detail = '${auto_detail}',
                      auto_update_dt = NOW(3)
                  WHERE auto_seq = ${auto_seq};`
    logger.info(upt_query);

    connection.query(upt_query, function (err, result, fields) {
        if (err) {
            logger.info(err);
            connection.end();
        }

        logger.info(result);
    });
});

//////// 상담사 코칭 조건 삭제 (8) ////////
router.get('/manage/counseling_deleting', function (req, res) {
    if (!req.session) { return res.render('manage/login'); }
    logger.info(`[받은 조건 번호: ${req.query.data}]`);

    let delete_seq = req.query.data;
    let counsel_query = `UPDATE emo_counsel_con 
                      SET del_yn = 'Y', 
                        use_unuse = 'N', 
                        auto_update_dt = NOW(3)
                      WHERE auto_seq IN (${delete_seq});`;

    // emo_counsel_con(코칭 조건 설정) 테이블에 INSERT
    connection.query(counsel_query, function (error, result) {
        if (error) {
            logger.error(error);
            connection.end();
        }
        logger.info(`해당 행 삭제 성공\n${counsel_query}`);

        res.send(result);
    });
});

//////// 상담사 수동 메세지 팝업 창 (9) ////////
router.get('/manage/coaching_message', function (req, res) {
    if (!req.session)
        return res.render('manage/login');

    res.render('manage/coaching_message', {
        title: "코칭 메세지"
    });
});

//////// 상담사 코칭 이력 조회 (10) ////////
router.get('/manage/counsel_history', function (req, res) {
    if (!req.session) { return res.render('manage/login'); }

    let search_date = req.query.dates;
    let select_auto_pass = req.query.stat_selected;

    logger.info(`코칭이력 조회 조건 ${select_auto_pass}`);

    let start_date = search_date.substring(6, 10) + '-' + search_date.substring(0, 2) + '-' + search_date.substring(3, 5);
    let end_date = search_date.substring(19, 23) + '-' + search_date.substring(13, 15) + '-' + search_date.substring(16, 18);

    if (select_auto_pass == 1) {
        select_auto_pass = `AND b.auto_coach = 'A'`;
    } else if (select_auto_pass == 2) {
        select_auto_pass = `AND b.auto_coach = 'P'`;
    } else {
        select_auto_pass = `AND b.auto_coach IN('A', 'P')`;
    }

    logger.info(`**********\n[시작 날짜]: ${start_date}\n[종료 날짜]: ${end_date}\n[코칭 여부]: ${select_auto_pass}\n**********`);

    let search_history_query = `SELECT 
                                a.agent_id,
                                a.agent_name,
                                b.auto_coach,
                                b.auto_standard,
                                b.auto_detail,
                                b.pass_etc
                              FROM emo_agent_info a
                                LEFT JOIN emo_coaching_message b
                                ON b.agent_id = a.agent_id
                              WHERE a.agent_id IN(1, 2)
                              AND b.send_yn = 'Y'
                              AND b.pass_etc IS NOT NULL\n`+
        select_auto_pass +
        `\nAND DATE(b.call_date) BETWEEN '${start_date}' AND '${end_date}';`;
    logger.info(search_history_query);

    connection.query(search_history_query, function (err, result) {
        if (err) {
            logger.error(err);
            connection.end();
        }
        logger.info(`[코칭 이력 테이블 조회 결과]\n${JSON.stringify(result)}`);

        return res.status(200).json({
            message: "SUCCESS",
            counsel_history: result
        });
    });
});

module.exports = router;