'use strict'

const mysql = require('mysql');
const logger = require('/home/test/ETRI/230714_ETRI/logs/logger');

module.exports = function() {
    return {
        init: function() {
            return mysql.createConnection({
                host: '211.41.186.209',
                port: '3306',
                user: 'root',
                password: 'nb1234',
                database: 'ETRI_EMOTION',
                multipleStatements: true, // 새롭게 추가된 조건
            })
        },

        db_open: function(con) {
            con.connect(function (err) {
                if (err) {
                    logger.error('MYSQL CONNECTION ERROR :' + err);
                } else {
                    logger.info('{"MYSQL IS CONNECTED SUCCESSFULLY!"}');
                }
            })
        }
    }
};