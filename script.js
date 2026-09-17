"use strict";

const VEHICLE_ID = "KDA123X";
const TTC_THRESHOLD = 6;
const ALERT_RADIUS = 0.5;
const SECRET_KEY = "OvertakeSafetyKey";
const AES_KEY = "AESSecret16Byte";
const AES_IV = "AESInitVector16";

const $ = id => document.getElementById(id);
const enc = new TextEncoder();
const dec = new TextDecoder();

let state;
let animationFrame;
let requestTimer;
let consentTimer;

const replayTable = new Map();

/* =========================================================
   ENCRYPTION AND SECURITY
========================================================= */

function pad16(text) {
    const output = new Uint8Array(16);
    output.set(enc.encode(text).slice(0, 16));
    return output;
}

function bytesToHex(bytes) {
    return [...new Uint8Array(bytes)]
        .map(byte => byte.toString(16).padStart(2, "0"))
        .join("");
}

function hexToBytes(hex) {
    const output = new Uint8Array(hex.length / 2);

    for (let i = 0; i < output.length; i++) {
        output[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }

    return output;
}

async function hmacSign(message) {
    if (!crypto.subtle) {
        return "DEMO-HMAC-" + simpleHash(message);
    }

    const key = await crypto.subtle.importKey(
        "raw",
        enc.encode(SECRET_KEY),
        {
            name: "HMAC",
            hash: "SHA-256"
        },
        false,
        ["sign"]
    );

    const signature = await crypto.subtle.sign(
        "HMAC",
        key,
        enc.encode(message)
    );

    return bytesToHex(signature);
}

async function encryptAES(plainText) {
    if (!crypto.subtle) {
        return bytesToHex(enc.encode(plainText));
    }

    const key = await crypto.subtle.importKey(
        "raw",
        pad16(AES_KEY),
        {
            name: "AES-CBC"
        },
        false,
        ["encrypt"]
    );

    const encrypted = await crypto.subtle.encrypt(
        {
            name: "AES-CBC",
            iv: pad16(AES_IV)
        },
        key,
        enc.encode(plainText)
    );

    return bytesToHex(encrypted);
}

async function decryptAES(cipherHex) {
    if (!crypto.subtle) {
        return dec.decode(hexToBytes(cipherHex));
    }

    try {
        const key = await crypto.subtle.importKey(
            "raw",
            pad16(AES_KEY),
            {
                name: "AES-CBC"
            },
            false,
            ["decrypt"]
        );

        const decrypted = await crypto.subtle.decrypt(
            {
                name: "AES-CBC",
                iv: pad16(AES_IV)
            },
            key,
            hexToBytes(cipherHex)
        );

        return dec.decode(decrypted);
    } catch {
        return "";
    }
}

function simpleHash(text) {
    let hash = 2166136261;

    for (const character of text) {
        hash = Math.imul(
            hash ^ character.charCodeAt(0),
            16777619
        );
    }

    return (hash >>> 0)
        .toString(16)
        .padStart(8, "0");
}

/* =========================================================
   GPS AND VEHICLE CALCULATIONS
========================================================= */

function haversine(lat1, lon1, lat2, lon2) {
    const earthRadius = 6371;
    const radians = number => number * Math.PI / 180;

    const latitudeDifference = radians(lat2 - lat1);
    const longitudeDifference = radians(lon2 - lon1);

    const calculation =
        Math.sin(latitudeDifference / 2) ** 2 +
        Math.cos(radians(lat1)) *
        Math.cos(radians(lat2)) *
        Math.sin(longitudeDifference / 2) ** 2;

    return earthRadius * 2 * Math.atan2(
        Math.sqrt(calculation),
        Math.sqrt(1 - calculation)
    );
}

function computeTTC(distanceKm, relativeSpeedKph) {
    if (relativeSpeedKph <= 0) {
        return 9999;
    }

    return distanceKm / relativeSpeedKph * 3600;
}

function headingDiff(heading1, heading2) {
    let difference = Math.abs(heading1 - heading2);

    if (difference > 180) {
        difference = 360 - difference;
    }

    return difference;
}

function classifyRole(myHeading, otherHeading) {
    const difference = headingDiff(
        myHeading,
        otherHeading
    );

    if (difference < 45) {
        return "FRONT";
    }

    if (difference > 135) {
        return "INCOMING";
    }

    return "SIDE";
}

/* =========================================================
   REPLAY PROTECTION
========================================================= */

function isReplay(senderID, counter) {
    if (
        replayTable.has(senderID) &&
        counter <= replayTable.get(senderID)
    ) {
        return true;
    }

    if (
        !replayTable.has(senderID) &&
        replayTable.size >= 8
    ) {
        const oldestSender =
            replayTable.keys().next().value;

        replayTable.delete(oldestSender);
    }

    replayTable.set(senderID, counter);
    renderReplay(senderID, false);

    return false;
}

/* =========================================================
   SIMULATION VALUES
========================================================= */

function values() {
    return {
        mySpeed: Number($("mySpeed").value),
        otherSpeed: Number($("otherSpeed").value),
        distance: Number($("distance").value),
        otherHeading: Number($("otherHeading").value)
    };
}

function sensorData() {
    const valuesData = values();

    const myLat = -0.303099;
    const myLon = 36.080025;

    const otherLat =
        myLat + valuesData.distance / 111.195;

    const otherLon = myLon;

    const measuredDistance = haversine(
        myLat,
        myLon,
        otherLat,
        otherLon
    );

    const role = classifyRole(
        0,
        valuesData.otherHeading
    );

    const relativeSpeed = Math.abs(
        valuesData.mySpeed -
        valuesData.otherSpeed
    );

    const ttc = computeTTC(
        measuredDistance,
        relativeSpeed
    );

    return {
        ...valuesData,
        myLat,
        myLon,
        otherLat,
        otherLon,
        measuredDistance,
        role,
        relativeSpeed,
        ttc
    };
}

/* =========================================================
   SECURE MESSAGE CREATION
========================================================= */

async function makeMessage(
    type = "REQUEST",
    targetID = "",
    sender = VEHICLE_ID
) {
    const data = sensorData();

    state.counter++;

    let counter = state.counter;

    if (
        $("packetMode").value === "replay" &&
        sender !== VEHICLE_ID
    ) {
        counter = replayTable.get(sender) || 1;
    }

    const rawPayload = [
        type,
        sender,
        targetID,
        counter,
        Math.floor(state.elapsed * 1000),
        data.myLat.toFixed(6),
        data.myLon.toFixed(6),
        data.mySpeed.toFixed(1),
        "0.0",
        data.role,
        data.ttc.toFixed(1)
    ].join(",");

    const encrypted = await encryptAES(
        rawPayload
    );

    let signature = await hmacSign(
        encrypted
    );

    if (
        $("packetMode").value === "bad-hmac" &&
        sender !== VEHICLE_ID
    ) {
        signature =
            signature.slice(0, -2) + "00";
    }

    $("rawPayload").textContent =
        rawPayload;

    $("encrypted").textContent =
        encrypted;

    $("signature").textContent =
        signature;

    return (
        "OVERTAKE_MSG:" +
        encrypted +
        ":" +
        signature
    );
}

/* =========================================================
   MESSAGE RECEIVING
========================================================= */

async function receiveMessage(message) {
    const firstSeparator =
        message.indexOf(":");

    const lastSeparator =
        message.lastIndexOf(":");

    if (
        firstSeparator < 0 ||
        lastSeparator <= firstSeparator
    ) {
        log("Malformed packet ignored");
        return;
    }

    const encrypted = message.slice(
        firstSeparator + 1,
        lastSeparator
    );

    const receivedSignature = message.slice(
        lastSeparator + 1
    );

    const calculatedSignature =
        await hmacSign(encrypted);

    if (
        calculatedSignature !==
        receivedSignature
    ) {
        log("Bad HMAC — packet rejected");
        return;
    }

    const rawPayload =
        await decryptAES(encrypted);

    if (!rawPayload) {
        log("Decrypt fail — packet rejected");
        return;
    }

    const fields = rawPayload.split(",");

    const type = fields[0];
    const senderID = fields[1];
    const targetID = fields[2];
    const counter = Number(fields[3]);

    if (senderID === VEHICLE_ID) {
        return;
    }

    if (isReplay(senderID, counter)) {
        renderReplay(senderID, true);

        log(
            "Replay ignored from " +
            senderID
        );

        return;
    }

    const data = sensorData();

    if (
        type === "REQUEST" &&
        data.role === "INCOMING" &&
        data.ttc < TTC_THRESHOLD &&
        data.measuredDistance < ALERT_RADIUS
    ) {
        showConsent(senderID);
    }

    if (
        type === "CONSENT_GRANTED" &&
        targetID === VEHICLE_ID
    ) {
        showGranted(senderID);
    }
}

/* =========================================================
   REQUEST BROADCASTING
========================================================= */

async function broadcastRequest() {
    if (!state.running) {
        return;
    }

    const outgoingMessage =
        await makeMessage();

    log(
        "Sent REQUEST: " +
        outgoingMessage.slice(0, 68) +
        "…"
    );

    const incomingMessage =
        await makeMessage(
            "REQUEST",
            "",
            "KBZ804Q"
        );

    await receiveMessage(
        incomingMessage
    );
}

/* =========================================================
   CONSENT REQUEST
========================================================= */

function showConsent(senderID) {
    clearInterval(consentTimer);

    state.requester = senderID;
    state.consentLeft = 4;

    lcd(
        "Overtake req",
        "Btn=Yes"
    );

    led("green", true);

    $("consent").disabled = false;

    $("consentTimer").textContent =
        "Request from " +
        senderID +
        " • 4.0 s";

    consentTimer = setInterval(() => {
        state.consentLeft -= 0.1;

        $("consentTimer").textContent =
            "Request from " +
            senderID +
            " • " +
            Math.max(
                0,
                state.consentLeft
            ).toFixed(1) +
            " s";

        if (state.consentLeft <= 0) {
            clearInterval(consentTimer);

            $("consent").disabled = true;

            led("green", false);

            lcd(
                "No consent",
                "Request expired"
            );

            log(
                "No consent sent to " +
                senderID
            );
        }
    }, 100);
}

async function grantConsent() {
    if (!state.requester) {
        return;
    }

    clearInterval(consentTimer);

    $("consent").disabled = true;

    led("green", false);

    lcd(
        "Consent sent",
        state.requester.slice(0, 16)
    );

    await makeMessage(
        "CONSENT_GRANTED",
        state.requester
    );

    log(
        "CONSENT_GRANTED sent to " +
        state.requester
    );

    const returnedMessage =
        await makeMessage(
            "CONSENT_GRANTED",
            VEHICLE_ID,
            state.requester
        );

    await receiveMessage(
        returnedMessage
    );
}

function showGranted(senderID) {
    lcd(
        "Consent from:",
        senderID.slice(0, 16)
    );

    led("green", true);

    log(
        "Valid consent received from " +
        senderID
    );

    setTimeout(() => {
        led("green", false);

        const data = sensorData();

        if (
            data.ttc >= TTC_THRESHOLD ||
            data.measuredDistance >= ALERT_RADIUS
        ) {
            lcd(
                "Proceed only if",
                "road is clear"
            );

            decision(
                "CONSENT + SAFE GAP",
                "safe"
            );
        } else {
            lcd(
                "DO NOT OVERTAKE",
                "Unsafe TTC"
            );

            decision(
                "OVERTAKE BLOCKED",
                "danger"
            );
        }
    }, 900);
}

/* =========================================================
   AUTOMATIC SAFETY
========================================================= */

function automaticSafety(data) {
    const mySpeedMps =
        data.mySpeed / 3.6;

    const otherSpeedMps =
        data.otherSpeed / 3.6;

    const brakingDeceleration = 6.5;
    const safetyMarginKm = 0.012;

    const stoppingDistanceKm =
        (
            mySpeedMps ** 2 +
            otherSpeedMps ** 2
        ) /
        (
            2 *
            brakingDeceleration
        ) /
        1000 +
        safetyMarginKm;

    const physicalTTC =
        data.role === "INCOMING"
            ? data.measuredDistance /
              Math.max(
                  1,
                  data.mySpeed +
                  data.otherSpeed
              ) *
              3600
            : data.ttc;

    if (
        data.role === "INCOMING" &&
        (
            physicalTTC < TTC_THRESHOLD ||
            stoppingDistanceKm >=
            data.measuredDistance
        )
    ) {
        decision(
            "AUTOMATIC SLOWING",
            "danger"
        );

        led("red", true);

        state.displaySpeed = Math.max(
            0,
            state.displaySpeed - 12 / 60
        );
    } else {
        const frontWarning =
            data.role === "FRONT" &&
            data.relativeSpeed > 0;

        decision(
            frontWarning
                ? "VEHICLE AHEAD"
                : "MONITORING",
            frontWarning
                ? "warn"
                : "safe"
        );

        led("red", false);

        state.displaySpeed +=
            (
                data.mySpeed -
                state.displaySpeed
            ) *
            0.02;
    }
}

/* =========================================================
   ANIMATION
========================================================= */

function animate(currentTime) {
    if (!state.running) {
        return;
    }

    const deltaTime = Math.min(
        0.05,
        (
            currentTime -
            state.last
        ) /
        1000
    );

    state.last = currentTime;
    state.elapsed += deltaTime;

    const data = sensorData();

    automaticSafety(data);
    drawRoad(data);
    renderMetrics(data);

    animationFrame =
        requestAnimationFrame(animate);
}

/* =========================================================
   ROAD DRAWING
========================================================= */

function drawRoad(data) {
    const canvas = $("road");
    const context = canvas.getContext("2d");

    const width = canvas.width;
    const height = canvas.height;

    context.clearRect(
        0,
        0,
        width,
        height
    );

    context.fillStyle = "#173b25";

    context.fillRect(
        0,
        0,
        width,
        height
    );

    context.fillStyle = "#363c42";

    context.fillRect(
        0,
        85,
        width,
        220
    );

    context.strokeStyle = "#f2d85c";
    context.lineWidth = 4;
    context.setLineDash([22, 17]);

    context.beginPath();
    context.moveTo(0, 195);
    context.lineTo(width, 195);
    context.stroke();

    context.setLineDash([]);

    context.fillStyle = "#e8edf1";
    context.font =
        "bold 14px system-ui";

    context.fillText(
        "KDA123X • LEFT LANE",
        45,
        60
    );

    context.fillText(
        data.role + " VEHICLE",
        width - 190,
        60
    );

    const myPosition = 110;

    const progress = Math.min(
        1,
        (
            1 -
            data.distance
        ) /
        0.95
    );

    const otherPosition =
        width -
        110 -
        progress *
        250;

    drawVehicle(
        context,
        myPosition,
        235,
        "#27d4ff",
        "KDA",
        false
    );

    drawVehicle(
        context,
        otherPosition,
        data.role === "INCOMING"
            ? 135
            : 235,
        "#ff9d61",
        "OTHER",
        data.role === "INCOMING"
    );

    context.strokeStyle =
        "#27d4ff88";

    context.lineWidth = 3;
    context.setLineDash([8, 7]);

    context.beginPath();

    context.arc(
        myPosition,
        235,
        65 +
        Math.sin(
            state.elapsed * 5
        ) *
        8,
        0,
        Math.PI * 2
    );

    context.stroke();
    context.setLineDash([]);

    context.fillStyle = "#a7bed0";
    context.font = "13px system-ui";

    context.fillText(
        "LoRa secure request every 3 seconds",
        330,
        350
    );
}

function drawVehicle(
    context,
    positionX,
    positionY,
    color,
    label,
    reverse
) {
    context.save();

    context.translate(
        positionX,
        positionY
    );

    if (reverse) {
        context.rotate(Math.PI);
    }

    context.fillStyle = color;

    context.fillRect(
        -37,
        -17,
        74,
        34
    );

    context.fillStyle = "#0a1822";

    context.fillRect(
        8,
        -13,
        21,
        26
    );

    context.fillStyle = "#07111d";
    context.font =
        "bold 11px system-ui";

    context.textAlign = "center";

    context.fillText(
        label,
        -8,
        4
    );

    context.restore();
}

/* =========================================================
   INTERFACE UPDATES
========================================================= */

function renderMetrics(data) {
    $("metricDistance").textContent =
        data.measuredDistance.toFixed(3) +
        " km";

    $("metricRelative").textContent =
        data.relativeSpeed.toFixed(0) +
        " km/h";

    $("metricTTC").textContent =
        data.ttc >= 9999
            ? "∞"
            : data.ttc.toFixed(1) +
              " s";

    $("metricRole").textContent =
        data.role;
}

function renderReplay(
    sender,
    replay
) {
    $("replayBody").innerHTML =
        [...replayTable]
            .map(
                ([id, counter]) => `
                    <tr>
                        <td>${id}</td>
                        <td>${counter}</td>
                        <td>
                            ${
                                id === sender &&
                                replay
                                    ? "REPLAY REJECTED"
                                    : "ACCEPTED"
                            }
                        </td>
                    </tr>
                `
            )
            .join("");
}

function lcd(line1, line2) {
    $("lcd1").textContent =
        line1
            .slice(0, 16)
            .padEnd(16);

    $("lcd2").textContent =
        line2
            .slice(0, 16)
            .padEnd(16);
}

function led(name, enabled) {
    $(name + "Led").className =
        name +
        (
            enabled
                ? " on"
                : ""
        );
}

function decision(text, level) {
    $("safetyDecision").textContent =
        text;

    $("safetyDecision").className =
        "decision " + level;
}

function log(message) {
    $("log").textContent =
        state.elapsed
            .toFixed(1)
            .padStart(5) +
        "s  " +
        message +
        "\n" +
        $("log").textContent;
}

/* =========================================================
   START AND RESET
========================================================= */

function start() {
    if (state.running) {
        return;
    }

    state.running = true;
    state.last = performance.now();

    $("start").textContent =
        "Running";

    $("systemBadge").textContent =
        "LORA ACTIVE";

    lcd(
        "Overtake Safety",
        "LoRa active"
    );

    broadcastRequest();

    requestTimer = setInterval(
        broadcastRequest,
        3000
    );

    animationFrame =
        requestAnimationFrame(animate);
}

function reset() {
    cancelAnimationFrame(
        animationFrame
    );

    clearInterval(
        requestTimer
    );

    clearInterval(
        consentTimer
    );

    replayTable.clear();

    state = {
        running: false,
        elapsed: 0,
        counter: 0,
        requester: "",
        displaySpeed:
            Number($("mySpeed").value),
        last: 0
    };

    $("start").textContent =
        "Start simulation";

    $("systemBadge").textContent =
        "SYSTEM READY";

    $("replayBody").innerHTML = `
        <tr>
            <td colspan="3">
                No packets received
            </td>
        </tr>
    `;

    $("rawPayload").textContent =
        "Waiting…";

    $("encrypted").textContent =
        "Waiting…";

    $("signature").textContent =
        "Waiting…";

    $("log").textContent =
        "115200 baud — System Ready";

    $("consent").disabled = true;

    $("consentTimer").textContent =
        "No consent request";

    lcd(
        "Overtake Safety",
        "System Ready"
    );

    led("green", false);
    led("red", false);

    decision(
        "MONITORING",
        "safe"
    );

    const data = sensorData();

    renderMetrics(data);
    drawRoad(data);
}

/* =========================================================
   EVENT LISTENERS
========================================================= */

[
    "mySpeed",
    "otherSpeed",
    "distance"
].forEach(id => {
    $(id).addEventListener(
        "input",
        () => {
            const suffix =
                id === "distance"
                    ? " km"
                    : " km/h";

            $(id + "Text").textContent =
                Number($(id).value)
                    .toFixed(
                        id === "distance"
                            ? 2
                            : 0
                    ) +
                suffix;

            if (!state.running) {
                const data =
                    sensorData();

                renderMetrics(data);
                drawRoad(data);
            }
        }
    );
});

$("otherHeading").addEventListener(
    "change",
    () => {
        if (!state.running) {
            const data =
                sensorData();

            renderMetrics(data);
            drawRoad(data);
        }
    }
);

$("start").addEventListener(
    "click",
    start
);

$("reset").addEventListener(
    "click",
    reset
);

$("consent").addEventListener(
    "click",
    grantConsent
);

reset();