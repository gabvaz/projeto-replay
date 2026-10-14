// Botão do replay — ESP32 ligado no Pi por USB (serial 115200).
//
// Protocolo por linha:
//   ESP32 -> Pi: BTN (apertou), HB (vivo, a cada 10s)
//   Pi -> ESP32: ACK (resposta ao HB), REC (gravando), OK, ERR, BUSY
//
// Ligação:
//   botão (NA) entre BUTTON_PIN e GND (usa pull-up interno)
//   LED entre LED_PIN e GND com resistor de 220-330 ohm (ou o LED da placa, GPIO 2)
//
// Estados do LED:
//   aceso fixo        pronto
//   piscando (4 Hz)   gravando
//   aceso 2s + pulso  ok (3 piscadas lentas)
//   piscando rápido   erro / ocupado (1.5s)
//   apagado           Pi sem responder (BTN sem resposta em 2s ou 3 HB sem ACK)

#include <Arduino.h>

const int BUTTON_PIN = 4;
const int LED_PIN = 2;

const unsigned long DEBOUNCE_MS = 50;
const unsigned long HB_EVERY_MS = 10000;
const unsigned long REPLY_TIMEOUT_MS = 2000;
// Pior caso: post-roll + concat + thumb num Pi 3 lento.
const unsigned long RECORDING_TIMEOUT_MS = 30000;
const unsigned long FEEDBACK_MS = 1500;
const unsigned long HOST_TIMEOUT_MS = 3 * HB_EVERY_MS + 2000;

enum State { READY, WAITING_REPLY, RECORDING, SHOW_OK, SHOW_ERR, NO_HOST };

State state = NO_HOST;
unsigned long stateSince = 0;
unsigned long lastHb = 0;
unsigned long lastHostMsg = 0;

int lastReading = HIGH;
int stableLevel = HIGH;
unsigned long lastChange = 0;

String line;

void setState(State next) {
  state = next;
  stateSince = millis();
}

void handleLine(const String &msg) {
  lastHostMsg = millis();
  if (msg == "ACK") {
    if (state == NO_HOST) setState(READY);
  } else if (msg == "REC") setState(RECORDING);
  else if (msg == "OK") setState(SHOW_OK);
  else if (msg == "ERR" || msg == "BUSY") setState(SHOW_ERR);
}

void readSerial() {
  while (Serial.available()) {
    char ch = (char)Serial.read();
    if (ch == '\n') {
      line.trim();
      if (line.length()) handleLine(line);
      line = "";
    } else if (line.length() < 32) {
      line += ch;
    }
  }
}

// true na borda de descida estável (apertou)
bool buttonPressed() {
  int reading = digitalRead(BUTTON_PIN);
  if (reading != lastReading) {
    lastChange = millis();
    lastReading = reading;
  }
  if (millis() - lastChange > DEBOUNCE_MS && reading != stableLevel) {
    stableLevel = reading;
    return stableLevel == LOW;
  }
  return false;
}

void updateLed() {
  unsigned long t = millis() - stateSince;
  bool on = true;
  switch (state) {
    case READY:
      on = true;
      break;
    case WAITING_REPLY:
    case RECORDING:
      on = (t / 125) % 2 == 0;
      break;
    case SHOW_OK:
      on = t < 2000 ? true : ((t - 2000) / 300) % 2 == 0;
      break;
    case SHOW_ERR:
      on = (t / 60) % 2 == 0;
      break;
    case NO_HOST:
      on = false;
      break;
  }
  digitalWrite(LED_PIN, on ? HIGH : LOW);
}

void updateTimeouts() {
  unsigned long t = millis() - stateSince;
  if (state == WAITING_REPLY && t > REPLY_TIMEOUT_MS) setState(NO_HOST);
  else if (state == RECORDING && t > RECORDING_TIMEOUT_MS) setState(SHOW_ERR);
  else if (state == SHOW_OK && t > 2000 + 6 * 300) setState(READY);
  else if (state == SHOW_ERR && t > FEEDBACK_MS) setState(READY);
  else if (state == READY && millis() - lastHostMsg > HOST_TIMEOUT_MS) setState(NO_HOST);
}

void setup() {
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  Serial.begin(115200);
  setState(NO_HOST);
  lastHb = millis() - HB_EVERY_MS;  // HB logo no boot pra acender assim que o Pi responder
}

void loop() {
  readSerial();

  // NO_HOST continua aceitando aperto: o Pi pode ter voltado.
  if (buttonPressed() && (state == READY || state == NO_HOST)) {
    Serial.println("BTN");
    setState(WAITING_REPLY);
  }

  if (millis() - lastHb > HB_EVERY_MS) {
    Serial.println("HB");
    lastHb = millis();
  }

  updateTimeouts();
  updateLed();
  delay(2);
}
