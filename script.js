"use strict";

const STORAGE_KEY = "hotpointToolsTrackerV1";
const ADMIN_USER = "ADMIN";
const ADMIN_PASSWORD = "Hotpoint_tools";

const seedTools = [
    {
        name: "Ladders",
        quantity: 2,
        description: "Access ladders for installation and service work."
    },
    {
        name: "Flaring Kit",
        quantity: 2,
        description: "Copper pipe flaring tools and accessories."
    },
    {
        name: "Oxy/Acetylene Gauge",
        quantity: 1,
        description: "Gauge set for controlled oxy-acetylene work."
    },
    {
        name: "Grinder",
        quantity: 2,
        description: "Portable angle grinder for workshop and site tasks."
    },
    {
        name: "Scaffolding",
        quantity: 1,
        description: "Mobile scaffolding set for elevated work."
    }
];

/* =========================================================
   GENERAL FUNCTIONS
   ========================================================= */

function uid() {
    return `${Date.now().toString(36)}${Math.random()
        .toString(36)
        .slice(2, 8)}`;
}

function today() {
    return new Date().toISOString().slice(0, 10);
}

function prettyDate(value) {
    if (!value) {
        return "—";
    }

    return new Date(`${value}T00:00:00`).toLocaleDateString(
        "en-GB",
        {
            day: "2-digit",
            month: "short",
            year: "numeric"
        }
    );
}

function escapeHTML(value) {
    return String(value).replace(/[&<>'"]/g, character => {
        return {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            "'": "&#39;",
            '"': "&quot;"
        }[character];
    });
}

function loadData() {
    try {
        const savedData = JSON.parse(
            localStorage.getItem(STORAGE_KEY)
        );

        if (
            savedData &&
            Array.isArray(savedData.tools) &&
            Array.isArray(savedData.history)
        ) {
            return savedData;
        }
    } catch (error) {
        console.error("Unable to load saved data:", error);
    }

    const initialData = {
        tools: seedTools.map(tool => ({
            ...tool,
            id: uid(),
            assignments: []
        })),
        history: []
    };

    saveData(initialData);

    return initialData;
}

function saveData(data) {
    localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(data)
    );

    window.dispatchEvent(
        new Event("tracker-updated")
    );
}

function available(tool) {
    return Math.max(
        0,
        tool.quantity - tool.assignments.length
    );
}

function statusChip(text, type) {
    return `
        <span class="status ${type}">
            ${escapeHTML(text)}
        </span>
    `;
}

/* =========================================================
   REQUEST TOOL PAGE
   ========================================================= */

function initRequest() {
    const searchInput =
        document.querySelector("#toolSearch");

    const historyFilter =
        document.querySelector("#historyFilter");

    function renderRequestPage() {
        const data = loadData();

        const searchText = searchInput.value
            .trim()
            .toLowerCase();

        const displayedTools = data.tools.filter(tool => {
            const searchableText = `
                ${tool.name}
                ${tool.description}
                ${tool.assignments
                    .map(item => item.technician)
                    .join(" ")}
            `.toLowerCase();

            return searchableText.includes(searchText);
        });

        const totalUnits = data.tools.reduce(
            (total, tool) => total + tool.quantity,
            0
        );

        const totalAvailable = data.tools.reduce(
            (total, tool) => total + available(tool),
            0
        );

        const totalAllocated = data.tools.reduce(
            (total, tool) =>
                total + tool.assignments.length,
            0
        );

        document.querySelector(
            "#totalUnits"
        ).textContent = totalUnits;

        document.querySelector(
            "#availableUnits"
        ).textContent = totalAvailable;

        document.querySelector(
            "#allocatedUnits"
        ).textContent = totalAllocated;

        document.querySelector("#toolGrid").innerHTML =
            displayedTools.map(tool => {
                const freeUnits = available(tool);

                const allocationList =
                    tool.assignments.length > 0
                        ? `
                            <div class="assignments">
                                ${tool.assignments
                                    .map(assignment => `
                                        <div class="assignment-line">
                                            <strong>
                                                ${escapeHTML(
                                                    assignment.technician
                                                )}
                                            </strong>

                                            <span>
                                                ${prettyDate(
                                                    assignment.assignedDate
                                                )}
                                            </span>
                                        </div>
                                    `)
                                    .join("")}
                            </div>
                        `
                        : "";

                return `
                    <article class="tool-card">
                        <div class="tool-title">
                            <h2>
                                ${escapeHTML(tool.name)}
                            </h2>

                            ${
                                freeUnits > 0
                                    ? statusChip(
                                        "AVAILABLE",
                                        "free"
                                    )
                                    : statusChip(
                                        "FULLY ALLOCATED",
                                        "busy"
                                    )
                            }
                        </div>

                        <p class="description">
                            ${escapeHTML(tool.description)}
                        </p>

                        <div class="availability">
                            <div>
                                <span>Total</span>
                                <strong>${tool.quantity}</strong>
                            </div>

                            <div>
                                <span>Free</span>
                                <strong>${freeUnits}</strong>
                            </div>

                            <div>
                                <span>Out</span>
                                <strong>
                                    ${tool.assignments.length}
                                </strong>
                            </div>
                        </div>

                        ${allocationList}
                    </article>
                `;
            }).join("");

        document.querySelector(
            "#emptyTools"
        ).hidden = displayedTools.length !== 0;

        renderTechnicianFilter(data);
        renderHistory(data);
    }

    function renderTechnicianFilter(data) {
        const technicianNames = [
            ...new Set(
                data.history.map(
                    record => record.technician
                )
            )
        ].sort();

        const selectedTechnician =
            historyFilter.value;

        historyFilter.innerHTML = `
            <option value="">All technicians</option>

            ${technicianNames
                .map(name => `
                    <option
                        value="${escapeHTML(name)}"
                        ${
                            name === selectedTechnician
                                ? "selected"
                                : ""
                        }
                    >
                        ${escapeHTML(name)}
                    </option>
                `)
                .join("")}
        `;
    }

    function renderHistory(data) {
        const selectedTechnician =
            historyFilter.value;

        const allocationHistory = data.history
            .filter(record => {
                return (
                    !selectedTechnician ||
                    record.technician ===
                        selectedTechnician
                );
            })
            .sort((first, second) => {
                return second.assignedDate.localeCompare(
                    first.assignedDate
                );
            });

        document.querySelector(
            "#historyBody"
        ).innerHTML = allocationHistory
            .map(record => `
                <tr>
                    <td>
                        ${escapeHTML(record.technician)}
                    </td>

                    <td>
                        ${escapeHTML(record.toolName)}
                    </td>

                    <td>
                        ${prettyDate(record.assignedDate)}
                    </td>

                    <td>
                        ${prettyDate(record.releasedDate)}
                    </td>

                    <td>
                        ${
                            record.releasedDate
                                ? statusChip(
                                    "Released",
                                    "free"
                                )
                                : statusChip(
                                    "Allocated",
                                    "busy"
                                )
                        }
                    </td>
                </tr>
            `)
            .join("");

        document.querySelector(
            "#emptyHistory"
        ).hidden = allocationHistory.length !== 0;
    }

    searchInput.addEventListener(
        "input",
        renderRequestPage
    );

    historyFilter.addEventListener(
        "change",
        renderRequestPage
    );

    window.addEventListener(
        "storage",
        renderRequestPage
    );

    window.addEventListener(
        "tracker-updated",
        renderRequestPage
    );

    renderRequestPage();
}

/* =========================================================
   ADMIN PAGE
   ========================================================= */

function initAdmin() {
    const loginPanel =
        document.querySelector("#loginPanel");

    const adminPanel =
        document.querySelector("#adminPanel");

    const assignedDateInput =
        document.querySelector("#assignedDate");

    assignedDateInput.value = today();

    function showAdminPanel() {
        loginPanel.hidden = true;
        adminPanel.hidden = false;

        renderAdmin();
    }

    if (
        sessionStorage.getItem("hotpointAdmin") === "yes"
    ) {
        showAdminPanel();
    }

    /* ADMIN LOGIN */

    document.querySelector("#loginForm")
        .addEventListener("submit", event => {
            event.preventDefault();

            const username =
                document.querySelector("#username").value;

            const password =
                document.querySelector("#password").value;

            const loginIsCorrect =
                username === ADMIN_USER &&
                password === ADMIN_PASSWORD;

            if (!loginIsCorrect) {
                document.querySelector(
                    "#loginError"
                ).textContent =
                    "Incorrect username or password.";

                return;
            }

            sessionStorage.setItem(
                "hotpointAdmin",
                "yes"
            );

            document.querySelector(
                "#loginError"
            ).textContent = "";

            showAdminPanel();
        });

    /* ADMIN LOGOUT */

    document.querySelector("#logoutBtn")
        .addEventListener("click", () => {
            sessionStorage.removeItem(
                "hotpointAdmin"
            );

            adminPanel.hidden = true;
            loginPanel.hidden = false;

            document.querySelector(
                "#password"
            ).value = "";
        });

    /* ADD NEW TOOL */

    document.querySelector("#toolForm")
        .addEventListener("submit", event => {
            event.preventDefault();

            const data = loadData();

            const toolName =
                document.querySelector(
                    "#toolName"
                ).value.trim();

            const toolQuantity = Number(
                document.querySelector(
                    "#toolQuantity"
                ).value
            );

            const toolDescription =
                document.querySelector(
                    "#toolDescription"
                ).value.trim();

            data.tools.push({
                id: uid(),
                name: toolName,
                quantity: toolQuantity,
                description: toolDescription,
                assignments: []
            });

            saveData(data);

            event.target.reset();

            document.querySelector(
                "#toolQuantity"
            ).value = 1;

            renderAdmin();
        });

    /* ASSIGN TOOL */

    document.querySelector("#assignmentForm")
        .addEventListener("submit", event => {
            event.preventDefault();

            const data = loadData();

            const selectedToolId =
                document.querySelector(
                    "#assignTool"
                ).value;

            const technicianName =
                document.querySelector(
                    "#technicianName"
                ).value.trim();

            const assignedDate =
                assignedDateInput.value;

            const tool = data.tools.find(
                item => item.id === selectedToolId
            );

            if (!tool || available(tool) < 1) {
                alert(
                    "The selected tool is not available."
                );

                return;
            }

            const allocationRecord = {
                id: uid(),
                toolId: tool.id,
                toolName: tool.name,
                technician: technicianName,
                assignedDate: assignedDate,
                releasedDate: ""
            };

            tool.assignments.push(allocationRecord);

            data.history.push({
                ...allocationRecord
            });

            saveData(data);

            event.target.reset();

            assignedDateInput.value = today();

            renderAdmin();
        });

    /* INVENTORY ACTIONS */

    document.querySelector("#adminInventory")
        .addEventListener("click", event => {
            const button = event.target.closest(
                "button[data-action]"
            );

            if (!button) {
                return;
            }

            const data = loadData();

            const tool = data.tools.find(
                item => item.id === button.dataset.tool
            );

            if (!tool) {
                return;
            }

            const action = button.dataset.action;

            /* REMOVE TOOL */

            if (action === "remove") {
                if (tool.assignments.length > 0) {
                    alert(
                        "Release all allocated units before removing this tool."
                    );

                    return;
                }

                const shouldRemove = confirm(
                    `Remove ${tool.name} from inventory?`
                );

                if (!shouldRemove) {
                    return;
                }

                data.tools = data.tools.filter(
                    item => item.id !== tool.id
                );
            }

            /* SAVE QUANTITY */

            if (action === "save") {
                const quantityInput =
                    document.querySelector(
                        `[data-quantity="${tool.id}"]`
                    );

                const newQuantity =
                    Number(quantityInput.value);

                if (
                    newQuantity <
                    tool.assignments.length
                ) {
                    alert(
                        `Quantity cannot be below ${tool.assignments.length} currently allocated unit(s).`
                    );

                    return;
                }

                if (newQuantity < 1) {
                    alert(
                        "Tool quantity must be at least 1."
                    );

                    return;
                }

                tool.quantity = newQuantity;
            }

            /* RELEASE TOOL */

            if (action === "release") {
                const assignment =
                    tool.assignments.find(item => {
                        return (
                            item.id ===
                            button.dataset.assignment
                        );
                    });

                if (!assignment) {
                    return;
                }

                tool.assignments =
                    tool.assignments.filter(item => {
                        return (
                            item.id !== assignment.id
                        );
                    });

                const historyRecord =
                    data.history.find(record => {
                        return (
                            record.id === assignment.id
                        );
                    });

                if (historyRecord) {
                    historyRecord.releasedDate = today();
                }
            }

            saveData(data);
            renderAdmin();
        });

    window.addEventListener(
        "storage",
        renderAdmin
    );
}

/* =========================================================
   RENDER ADMIN INVENTORY
   ========================================================= */

function renderAdmin() {
    const data = loadData();

    const toolSelect =
        document.querySelector("#assignTool");

    if (!toolSelect) {
        return;
    }

    const freeTools = data.tools.filter(
        tool => available(tool) > 0
    );

    if (freeTools.length > 0) {
        toolSelect.innerHTML = freeTools
            .map(tool => `
                <option value="${tool.id}">
                    ${escapeHTML(tool.name)}
                    (${available(tool)} free)
                </option>
            `)
            .join("");
    } else {
        toolSelect.innerHTML = `
            <option value="">
                No tools available
            </option>
        `;
    }

    document.querySelector(
        "#assignBtn"
    ).disabled = freeTools.length === 0;

    const inventoryContainer =
        document.querySelector("#adminInventory");

    if (data.tools.length === 0) {
        inventoryContainer.innerHTML = `
            <div class="empty">
                No tools in inventory.
                Add the first tool above.
            </div>
        `;

        return;
    }

    inventoryContainer.innerHTML = data.tools
        .map(tool => {
            const currentAssignments =
                tool.assignments.length > 0
                    ? `
                        <div class="current-list">
                            ${tool.assignments
                                .map(assignment => `
                                    <div class="current-item">
                                        <div>
                                            <strong>
                                                ${escapeHTML(
                                                    assignment.technician
                                                )}
                                            </strong>

                                            <br>

                                            <small>
                                                Assigned
                                                ${prettyDate(
                                                    assignment.assignedDate
                                                )}
                                            </small>
                                        </div>

                                        <button
                                            data-action="release"
                                            data-tool="${tool.id}"
                                            data-assignment="${assignment.id}"
                                        >
                                            Release Tool
                                        </button>
                                    </div>
                                `)
                                .join("")}
                        </div>
                    `
                    : "";

            return `
                <article class="inventory-row">
                    <div class="inventory-head">
                        <div>
                            <h2>
                                ${escapeHTML(tool.name)}
                            </h2>

                            <p>
                                ${escapeHTML(
                                    tool.description
                                )}
                                •
                                ${available(tool)}
                                of
                                ${tool.quantity}
                                available
                            </p>
                        </div>

                        <label>
                            Quantity

                            <input
                                data-quantity="${tool.id}"
                                type="number"
                                min="${tool.assignments.length || 1}"
                                value="${tool.quantity}"
                            >
                        </label>

                        <div class="inventory-actions">
                            <button
                                data-action="save"
                                data-tool="${tool.id}"
                            >
                                Save
                            </button>

                            <button
                                class="danger-button"
                                data-action="remove"
                                data-tool="${tool.id}"
                            >
                                Remove
                            </button>
                        </div>
                    </div>

                    ${currentAssignments}
                </article>
            `;
        })
        .join("");
}

/* =========================================================
   START CORRECT PAGE
   ========================================================= */

if (document.body.dataset.page === "request") {
    initRequest();
}

if (document.body.dataset.page === "admin") {
    initAdmin();
}
