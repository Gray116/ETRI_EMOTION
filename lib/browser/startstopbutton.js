'use strict';

function createStartStopButton(onStart, onStop) {
  $('.startButton1').click(function() {    
    try {
      onStart();

      $('.stopButton1').attr('disabled', false);
      $('.stopButton1').addClass('btn-dark');

      $('.startButton1').attr('disabled', true);
      $('.startButton1').removeClass('btn-danger');
      $('.startButton1').val("통화 중");
    } catch (error) {
      $('.startButton1').attr('disabled', false);
      console.log(error);
    }
  });
  
  $('.stopButton1').click(function() {
    try {
      onStop();

      $('.startButton1').attr('disabled', false);
      $('.startButton1').addClass('btn-danger');
      $('.startButton1').val("전화 받기");

      $('.stopButton1').attr('disabled', true);
      $('.stopButton1').removeClass('btn-dark');
    } catch (error) {
      $('.stopButton1').attr('disabled', false);
      console.log(error);
    }
  });
}

module.exports = createStartStopButton;