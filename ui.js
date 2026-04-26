/*
 * ui.js -- Pipeline Logic Datastructures
 *
 * Author: Esraaj Sarkar Gupta, Rohan Gupta
 */
function getStageDescription(inst, stage, cycle = null) {
    if (!inst || !inst.opcode) return '';
    switch(stage) {
        case 'IF': return `Fetches ${inst.opcode}`;
        case 'ID': return `Decodes ${inst.opcode}`;
        case 'EX':
            if (inst.kind === 'ALU') return `Uses ${inst.sources.join(' & ')}`;
            if (inst.opcode === 'LW' || inst.opcode === 'SW') return `Computes address`;
            return 'Executes';
        case 'MEM':
            if (inst.opcode === 'LW') return `Reads Memory`;
            if (inst.opcode === 'SW') return `Writes Memory`;
            if (!inst.timing.wbCycle && inst.dest) return `Writes ${inst.dest}`;
            return `Passes result`;
        case 'MEM/WB':
            if (inst.opcode === 'LW') return `Reads & writes ${inst.dest}`;
            if (inst.opcode === 'SW') return `Writes Memory`;
            if (inst.dest) return `Writes ${inst.dest}`;
            return `Completes`;
        case 'WB':
            if (inst.opcode === 'SW') return `No write-back`;
            return `Writes to ${inst.dest}`;
        case 'ST':
            return getStallDescription(inst, cycle);
        default: return '';
    }
}

function getStallDescription(inst, cycle) {
    if (!inst || !inst.stallReasons || !cycle || !inst.stallReasons[cycle]) {
        return 'Waiting';
    }

    const registers = [...inst.stallReasons[cycle].matchAll(/\bR\d+\b/g)]
        .map(match => match[0]);

    if (registers.length === 0) return 'Waiting';
    return `Waiting for ${[...new Set(registers)].join(', ')}`;
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}

function renderInitialTable(simulator) {
    const header = document.getElementById('table-header');
    header.innerHTML = '<th class="instruction-cell py-2 px-3 font-medium border-r border-slate-600"><div class="instruction-pane">Instruction</div></th>';
    
    const tbody = document.getElementById('table-body');
    tbody.innerHTML = '';

    if (simulator.instructions.length === 0) {
        const message = simulator.errors && simulator.errors.length > 0
            ? 'Input was rejected. Fix the listed line errors and load again.'
            : 'Load instructions to begin simulation.';
        tbody.innerHTML = `<tr><td colspan="100%" class="py-8 text-center text-slate-500 italic">${message}</td></tr>`;
    }
    
    simulator.instructions.forEach(inst => {
        const tr = document.createElement('tr');
        tr.className = 'border-b border-slate-700/50 pipeline-row transition-colors';
        tr.id = `row-${inst.id}`;
        tr.innerHTML = `<td class="instruction-cell py-2 px-3 font-mono text-blue-300 border-r border-slate-700/50"><div class="instruction-pane">${inst.id}: ${escapeHtml(inst.rawText)}</div></td>`;
        tbody.appendChild(tr);
    });

    renderHazardLog(simulator);
    renderForwardingLog(simulator);
    drawForwardingArrows(simulator);
}

function updateUI(simulator) {
    // 1. Expand Header with current cycle
    const header = document.getElementById('table-header');
    header.innerHTML = '<th class="instruction-cell py-2 px-3 font-medium border-r border-slate-600"><div class="instruction-pane">Instruction</div></th>';
    for (let i = 1; i <= simulator.cycle; i++) {
        const th = document.createElement('th');
        th.className = 'cycle-cell py-2 px-2 font-medium text-center border-r border-slate-600 text-slate-300';
        th.setAttribute('data-cycle-header', i);
        th.innerText = `C${i}`;
        header.appendChild(th);
    }

    // 2. Render Stage Cells
    simulator.instructions.forEach(inst => {
        const row = document.getElementById(`row-${inst.id}`);
        row.innerHTML = `<td class="instruction-cell py-2 px-3 font-mono text-blue-300 border-r border-slate-700/50"><div class="instruction-pane">${inst.id}: ${escapeHtml(inst.rawText)}</div></td>`;
        
        inst.stages.forEach((stage, index) => {
            const td = document.createElement('td');
            td.className = 'cycle-cell py-1 px-1 text-center border-r border-slate-700/50';
            
            if (stage) {
                const cycle = index + 1;
                const span = document.createElement('span');
                const isNew = index === inst.stages.length - 1;
                const popClass = isNew ? ' animate-pop-in' : '';
                const forwardClass = getForwardingCellClass(simulator, inst.id, stage, cycle);
                span.className = `stage-cell block w-full text-xs ${stage === 'ST' ? 'stage-stall' : 'stage-normal'} ${forwardClass}${popClass}`;
                
                const desc = getStageDescription(inst, stage, cycle);
                span.innerHTML = `<span class="text-sm font-bold">${stage}</span><span class="text-[0.6rem] font-medium opacity-80 mt-0.5 block whitespace-normal leading-tight">${desc}</span>`;
                
                span.setAttribute('data-cell-id', `${inst.id}-${stage}-${cycle}`);
                const tooltip = stage === 'ST' && inst.stallReasons && inst.stallReasons[cycle]
                    ? `Cycle ${cycle}: ${inst.id} stalled. ${inst.stallReasons[cycle]}.`
                    : `Cycle ${cycle}: ${inst.id} is in ${stage}`;
                span.setAttribute('data-tooltip', tooltip);
                td.appendChild(span);
            }
            row.appendChild(td);
        });
    });

    renderHazardLog(simulator);
    renderForwardingLog(simulator);
    drawForwardingArrows(simulator);
}

function getForwardingCellClass(simulator, instructionId, stage, cycle) {
    if (!simulator.visibleForwardingEvents) return '';

    const isSource = simulator.visibleForwardingEvents.some(event =>
        event.fromInstruction === instructionId &&
        event.fromStage === stage &&
        event.fromCycle === cycle
    );
    const isTarget = simulator.visibleForwardingEvents.some(event =>
        event.toInstruction === instructionId &&
        event.toStage === stage &&
        event.toCycle === cycle
    );

    if (isSource && isTarget) return 'stage-forward-source stage-forward-target';
    if (isSource) return 'stage-forward-source';
    if (isTarget) return 'stage-forward-target';
    return '';
}

function renderHazardLog(simulator) {
    const log = document.getElementById('hazard-log');
    if (simulator.errors && simulator.errors.length > 0) {
        log.innerHTML = simulator.errors.map(error => `<li class="text-amber-300 font-mono text-xs">${escapeHtml(error)}</li>`).join('');
    } else if (simulator.hazards.length > 0) {
        log.innerHTML = simulator.hazards.map(h => `<li class="text-red-300 font-mono text-xs">${h}</li>`).join('');
    } else if (simulator.fullHazards && simulator.fullHazards.length > 0 && simulator.cycle === 0) {
        log.innerHTML = '<li class="text-slate-500 italic">Hazards will appear as you step or run.</li>';
    } else {
        log.innerHTML = '<li class="text-slate-500 italic">No hazards detected.</li>';
    }
}

function renderForwardingLog(simulator) {
    const log = document.getElementById('forwarding-log');
    if (!log) return;

    const pipelineName = simulator.pipelineType === 5
        ? '5-stage IF/ID/EX/MEM/WB'
        : '4-stage IF/ID/EX/MEM, where MEM is the combined MEM/WB completion stage';

    const rule = simulator.forwarding
        ? `Assumption: standard single-issue in-order MIPS forwarding on the ${pipelineName} pipeline. ID reads registers and decodes memory offset/base operands. A WB/completion write is visible to an ID read in the same cycle, so no bypass arrow is drawn for that case. ALU results may be bypassed from EX/MEM or MEM/WB to a later EX input. Load data is available only after MEM, so a direct load-use EX consumer stalls once before MEM/WB -> EX forwarding. Store data is consumed in MEM, so store-data dependencies forward to MEM.`
        : `Forwarding is disabled. RAW hazards are resolved only by stalls. The no-forwarding model assumes no split register access, so a consumer waits until the cycle after the producer reaches WB, or MEM in the 4-stage pipeline.`;

    const visibleEvents = simulator.visibleForwardingEvents || [];
    const allEvents = simulator.forwardingEvents || [];

    let transferContent = '<p class="text-slate-500 italic">No forwarding transfers are active.</p>';
    if (simulator.forwarding && visibleEvents.length > 0) {
        transferContent = `<ul class="space-y-2">${visibleEvents.map(event => `
            <li class="rounded-md border border-amber-300/25 bg-amber-400/10 px-3 py-2">
                <span class="font-mono text-amber-200">${event.register}</span>
                from <span class="font-mono">${event.fromInstruction} ${event.fromStage}</span>
                at C${event.fromCycle} to
                <span class="font-mono">${event.toInstruction} ${event.toStage}</span>
                at C${event.toCycle}
                <span class="block text-xs text-slate-400 mt-1">${event.rule}; ${event.role}.</span>
            </li>
        `).join('')}</ul>`;
    } else if (simulator.forwarding && allEvents.length > 0 && simulator.cycle === 0) {
        transferContent = '<p class="text-slate-500 italic">Forwarding transfers are planned and will appear as you step or auto-run.</p>';
    } else if (simulator.forwarding && simulator.instructions.length > 0) {
        transferContent = '<p class="text-slate-500 italic">No RAW dependency needs forwarding in the visible cycles.</p>';
    }

    log.innerHTML = `
        <p class="text-xs leading-relaxed text-slate-300">${rule}</p>
        ${transferContent}
    `;
}

function drawForwardingArrows(simulator) {
    const viewer = document.getElementById('pipeline-viewer');
    const overlay = document.getElementById('forwarding-overlay');
    if (!viewer || !overlay) return;
    updateInstructionShield();

    const table = viewer.querySelector('.pipeline-table');
    const contentWidth = Math.max(table ? table.offsetWidth : 0, viewer.clientWidth);
    const contentHeight = Math.max(table ? table.offsetHeight : 0, viewer.clientHeight);

    overlay.innerHTML = '';
    overlay.setAttribute('width', contentWidth);
    overlay.setAttribute('height', contentHeight);
    overlay.style.width = `${contentWidth}px`;
    overlay.style.height = `${contentHeight}px`;
    clampPipelineScroll();

    const events = simulator.visibleForwardingEvents || [];
    if (events.length === 0) return;

    const namespace = 'http://www.w3.org/2000/svg';
    const defs = document.createElementNS(namespace, 'defs');
    const marker = document.createElementNS(namespace, 'marker');
    marker.setAttribute('id', 'forward-arrowhead');
    marker.setAttribute('markerWidth', '9');
    marker.setAttribute('markerHeight', '9');
    marker.setAttribute('refX', '7.5');
    marker.setAttribute('refY', '4.5');
    marker.setAttribute('orient', 'auto');
    const arrowHead = document.createElementNS(namespace, 'path');
    arrowHead.setAttribute('d', 'M 0 0 L 9 4.5 L 0 9 z');
    arrowHead.setAttribute('fill', '#fbbf24');
    arrowHead.setAttribute('fill-opacity', '0.82');
    marker.appendChild(arrowHead);
    defs.appendChild(marker);
    overlay.appendChild(defs);

    const viewerRect = viewer.getBoundingClientRect();

    events.forEach(event => {
        const fromCell = document.querySelector(`[data-cell-id="${event.fromInstruction}-${event.fromStage}-${event.fromCycle}"]`);
        const toCell = document.querySelector(`[data-cell-id="${event.toInstruction}-${event.toStage}-${event.toCycle}"]`);
        if (!fromCell || !toCell) return;

        const fromRect = fromCell.getBoundingClientRect();
        const toRect = toCell.getBoundingClientRect();
        const x1 = fromRect.left - viewerRect.left + viewer.scrollLeft + fromRect.width * 0.55;
        const y1 = fromRect.top - viewerRect.top + viewer.scrollTop + fromRect.height * 0.5;
        const x2 = toRect.left - viewerRect.left + viewer.scrollLeft + toRect.width * 0.45;
        const y2 = toRect.top - viewerRect.top + viewer.scrollTop + toRect.height * 0.5;
        const midX = (x1 + x2) / 2;
        const lift = Math.max(18, Math.min(48, Math.abs(y2 - y1) + 18));

        const path = document.createElementNS(namespace, 'path');
        path.setAttribute('d', `M ${x1} ${y1} C ${midX} ${y1 - lift}, ${midX} ${y2 - lift}, ${x2} ${y2}`);
        path.setAttribute('class', 'forwarding-path');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', '#fbbf24');
        path.setAttribute('stroke-width', '2.4');
        path.setAttribute('stroke-opacity', '0.82');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('marker-end', 'url(#forward-arrowhead)');

        const title = document.createElementNS(namespace, 'title');
        title.textContent = event.hoverText || event.text;
        path.appendChild(title);
        overlay.appendChild(path);
    });
}

function updateInstructionShield() {
    const viewer = document.getElementById('pipeline-viewer');
    const shield = document.getElementById('instruction-shield');
    if (!viewer || !shield) return;

    shield.style.height = `${viewer.scrollHeight}px`;
    shield.style.transform = `translateX(${viewer.scrollLeft}px)`;
}

function clampPipelineScroll() {
    const viewer = document.getElementById('pipeline-viewer');
    if (!viewer) return;

    const table = viewer.querySelector('.pipeline-table');
    const contentWidth = Math.max(table ? table.offsetWidth : 0, viewer.clientWidth);
    const maxScrollLeft = Math.max(0, contentWidth - viewer.clientWidth);

    if (viewer.scrollLeft > maxScrollLeft) {
        viewer.scrollLeft = maxScrollLeft;
    }

    updateInstructionShield();
}

function scrollPipelineToCurrentCycle() {
    const viewer = document.getElementById('pipeline-viewer');
    if (!viewer) return;

    requestAnimationFrame(() => {
        const currentHeader = document.querySelector(`[data-cycle-header="${simulator.cycle}"]`);
        if (!currentHeader) return;

        const viewerRect = viewer.getBoundingClientRect();
        const headerRect = currentHeader.getBoundingClientRect();
        const rightOverflow = headerRect.right - (viewerRect.right - 18);

        if (rightOverflow > 0) {
            viewer.scrollBy({
                left: rightOverflow,
                behavior: 'smooth'
            });
        }
        updateInstructionShield();
    });
}

// --- Event Listeners ---
const simulator = new PipelineSimulator();
const AUTO_RUN_DELAY_MS = 600;
let autoRunTimer = null;
let isAutoRunning = false;

function setExecutionButtonsDisabled(disabled) {
    document.getElementById('btn-step').disabled = disabled;
    document.getElementById('btn-run').disabled = disabled;
    document.getElementById('btn-restart').disabled = disabled;
}

function setInputControlsDisabled(disabled) {
    document.getElementById('btn-parse').disabled = disabled;
    document.getElementById('btn-reset').disabled = disabled;
    document.getElementById('pipeline-type').disabled = disabled;
    document.getElementById('enable-forwarding').disabled = disabled;
    document.getElementById('preset-dropdown').disabled = disabled;
    document.getElementById('instruction-input').disabled = disabled;
}

function updateForwardingStatusLabel() {
    const status = document.getElementById('forwarding-status');
    const cardStatus = document.getElementById('forwarding-card-status');
    const forwardingEnabled = document.getElementById('enable-forwarding').checked;

    if (status) {
        status.innerText = forwardingEnabled ? 'Enabled' : 'Disabled';
        status.className = forwardingEnabled
            ? 'font-semibold text-emerald-300'
            : 'font-semibold text-red-300';
    }

    if (cardStatus) {
        cardStatus.innerText = forwardingEnabled ? 'Enabled' : 'Disabled';
        cardStatus.className = forwardingEnabled
            ? 'forwarding-mode-badge forwarding-mode-enabled'
            : 'forwarding-mode-badge forwarding-mode-disabled';
    }
}

function stopAutoRun() {
    if (autoRunTimer) {
        clearTimeout(autoRunTimer);
        autoRunTimer = null;
    }

    if (isAutoRunning) {
        isAutoRunning = false;
        document.getElementById('btn-run').innerText = 'Auto-Run';
        setInputControlsDisabled(false);
        const hasRunnableProgram = simulator.errors.length === 0 && simulator.instructions.length > 0;
        setExecutionButtonsDisabled(!hasRunnableProgram);
    }
}

function getLoadedInstructionLines() {
    return simulator.instructions.map(inst => inst.rawText);
}

function reloadLoadedProgramWithCurrentForwarding() {
    const loadedLines = getLoadedInstructionLines();
    simulator.forwarding = document.getElementById('enable-forwarding').checked;

    if (loadedLines.length === 0) return false;

    simulator.loadInstructions(loadedLines);
    renderInitialTable(simulator);
    updateRunButtonAvailability();
    return simulator.errors.length === 0;
}

function syncForwardingBeforeRun() {
    if (simulator.forwarding === document.getElementById('enable-forwarding').checked) {
        return true;
    }

    return reloadLoadedProgramWithCurrentForwarding();
}

function updateRunConfigurationLock() {
    const hasRunnableProgram = simulator.errors.length === 0 && simulator.instructions.length > 0;
    const runInProgress = hasRunnableProgram && simulator.cycle > 0 && simulator.cycle < simulator.getMaxCycle();

    document.getElementById('enable-forwarding').disabled = runInProgress || isAutoRunning;
}

function updateRunButtonAvailability() {
    const hasRunnableProgram = simulator.errors.length === 0 && simulator.instructions.length > 0;
    const hasMoreCycles = hasRunnableProgram && simulator.cycle < simulator.getMaxCycle();

    document.getElementById('btn-step').disabled = !hasMoreCycles;
    document.getElementById('btn-run').disabled = !hasMoreCycles;
    document.getElementById('btn-restart').disabled = !hasRunnableProgram;
    updateRunConfigurationLock();
}

function autoRunNextCycle() {
    if (!isAutoRunning) return;

    if (simulator.cycle >= simulator.getMaxCycle()) {
        stopAutoRun();
        updateRunButtonAvailability();
        return;
    }

    simulator.step();
    updateUI(simulator);
    scrollPipelineToCurrentCycle();

    if (simulator.cycle >= simulator.getMaxCycle()) {
        stopAutoRun();
        updateRunButtonAvailability();
        return;
    }

    autoRunTimer = setTimeout(autoRunNextCycle, AUTO_RUN_DELAY_MS);
}

document.getElementById('btn-parse').addEventListener('click', () => {
    stopAutoRun();
    const inputText = document.getElementById('instruction-input').value;
    simulator.pipelineType = parseInt(document.getElementById('pipeline-type').value);
    simulator.forwarding = document.getElementById('enable-forwarding').checked;
    
    simulator.loadInstructions(inputText.split('\n'));
    renderInitialTable(simulator);
    updateRunButtonAvailability();
});

document.getElementById('btn-step').addEventListener('click', () => {
    stopAutoRun();
    if (!syncForwardingBeforeRun()) return;
    simulator.step();
    updateUI(simulator);
    updateRunButtonAvailability();
});

document.getElementById('btn-run').addEventListener('click', () => {
    if (isAutoRunning || simulator.instructions.length === 0 || simulator.errors.length > 0) return;
    if (!syncForwardingBeforeRun()) return;

    isAutoRunning = true;
    document.getElementById('btn-run').innerText = 'Running...';
    setInputControlsDisabled(true);
    setExecutionButtonsDisabled(true);
    autoRunTimer = setTimeout(autoRunNextCycle, AUTO_RUN_DELAY_MS);
});

document.getElementById('btn-restart').addEventListener('click', () => {
    stopAutoRun();
    simulator.resetRun();
    renderInitialTable(simulator);
    updateRunButtonAvailability();
});

document.getElementById('btn-reset').addEventListener('click', () => {
    stopAutoRun();
    document.getElementById('instruction-input').value = '';
    document.getElementById('preset-dropdown').value = '';
    simulator.instructions = [];
    simulator.cycle = 0;
    simulator.hazards = [];
    simulator.fullHazards = [];
    simulator.forwardingEvents = [];
    simulator.visibleForwardingEvents = [];
    simulator.errors = [];
    renderInitialTable(simulator);
    
    const tbody = document.getElementById('table-body');
    tbody.innerHTML = '<tr><td colspan="100%" class="py-8 text-center text-slate-500 italic">Load instructions to begin simulation.</td></tr>';
    
    updateRunButtonAvailability();
});

document.getElementById('enable-forwarding').addEventListener('change', () => {
    stopAutoRun();
    updateForwardingStatusLabel();
    reloadLoadedProgramWithCurrentForwarding();
});

const pipelinePresets = {
    4: [
        {
            label: 'TC1: ALU RAW',
            value: '4-tc1',
            program: 'ADD R1, R2, R3\nSUB R4, R1, R5'
        },
        {
            label: 'TC2: ALU RAW with gap',
            value: '4-tc2',
            program: 'ADD R1, R2, R3\nAND R6, R7, R8\nSUB R4, R1, R5'
        },
        {
            label: 'TC3: Load-use RAW',
            value: '4-tc3',
            program: 'LW R1, 0(R2)\nADD R3, R1, R4'
        },
        {
            label: 'TC4: Load-use with gap',
            value: '4-tc4',
            program: 'LW R1, 0(R2)\nORI R6, R7, 7\nADD R3, R1, R4'
        },
        {
            label: 'TC5: Chained overwrite RAW',
            value: '4-tc5',
            program: 'ADD R1, R2, R3\nADD R1, R1, R4\nSUB R5, R1, R6'
        },
        {
            label: 'TC6: Store data RAW',
            value: '4-tc6',
            program: 'ADD R1, R2, R3\nSW R1, 0(R4)'
        }
    ],
    5: [
        {
            label: 'TC1: No dependency',
            value: '5-tc1',
            program: 'ADD R1, R2, R3\nSUB R4, R5, R6'
        },
        {
            label: 'TC2: ALU RAW',
            value: '5-tc2',
            program: 'ADD R1, R2, R3\nSUB R4, R1, R5'
        },
        {
            label: 'TC3: Load-use RAW',
            value: '5-tc3',
            program: 'LW R1, 0(R2)\nADD R3, R1, R4'
        },
        {
            label: 'TC4: Store data with gap',
            value: '5-tc4',
            program: 'ADD R1, R2, R3\nADD R4, R5, R6\nSW R1, 0(R7)'
        },
        {
            label: 'TC5: Load and ALU chain',
            value: '5-tc5',
            program: 'LW R1, 0(R2)\nADD R3, R1, R4\nSUB R5, R3, R6'
        },
        {
            label: 'TC6: Load-add-store chain',
            value: '5-tc6',
            program: 'LW R8, 4(R2)\nADD R9, R8, R6\nSW R9, 0(R10)'
        },
        {
            label: 'TC7: Longer mixed chain',
            value: '5-tc7',
            program: 'LW R1, 0(R2)\nADD R3, R1, R4\nSUB R5, R3, R6\nLW R7, 4(R2)'
        }
    ]
};

function getSelectedPipelineType() {
    return parseInt(document.getElementById('pipeline-type').value);
}

function populatePresetDropdown() {
    const dropdown = document.getElementById('preset-dropdown');
    const pipelineType = getSelectedPipelineType();
    const presets = pipelinePresets[pipelineType] || [];

    dropdown.innerHTML = `<option value="">Load ${pipelineType}-Stage Test Case...</option>`;
    presets.forEach(preset => {
        const option = document.createElement('option');
        option.value = preset.value;
        option.textContent = preset.label;
        dropdown.appendChild(option);
    });
}

document.getElementById('preset-dropdown').addEventListener('change', (e) => {
    const val = e.target.value;
    const pipelineType = getSelectedPipelineType();
    const preset = (pipelinePresets[pipelineType] || []).find(item => item.value === val);
    if (preset) {
        document.getElementById('instruction-input').value = preset.program;
    }
});

document.getElementById('pipeline-type').addEventListener('change', () => {
    stopAutoRun();
    document.getElementById('preset-dropdown').value = '';
    populatePresetDropdown();
});

populatePresetDropdown();
updateForwardingStatusLabel();

document.getElementById('pipeline-viewer').addEventListener('scroll', () => {
    clampPipelineScroll();
    drawForwardingArrows(simulator);
});

window.addEventListener('resize', () => {
    clampPipelineScroll();
    drawForwardingArrows(simulator);
});
