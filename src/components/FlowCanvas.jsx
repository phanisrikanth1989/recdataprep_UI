import { useJob } from '../context/JobContext';
import { getComponentIcon, getComponentDisplayName } from '../model/componentModel';
import { Workflow, Sun, Moon, Save, Play, X, Trash2 } from 'lucide-react';
import { useState, useEffect, useRef, useCallback } from 'react';
import './FlowCanvas.css';

/**
 * FlowCanvas Component
 *
 * Renders the ETL flow from job.components and job.flows
 * No hardcoded data - reads entirely from JobContext
 */

export default function FlowCanvas({ onComponentClick }) {
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [drawerLevel, setDrawerLevel] = useState(0);
  const [activeTab, setActiveTab] = useState('Context');
  const [contextValues, setContextValues] = useState({});
  const dragState = useRef(null);
  const clickTimeout = useRef(null);
  const { job, updateJob, updateComponentData, executionState, executeJob, clearExecutionResults, downloadOutputFile, loadJob } = useJob();

  // Add selected node state for delete functionality
  const [selectedNodeId, setSelectedNodeId] = useState(null);

  // Flow connection creation state
  const [connectionDragState, setConnectionDragState] = useState({
    isDragging: false,
    sourceComponentId: null,
    sourcePort: null,
    currentX: 0,
    currentY: 0
  });
  const [hoveredAnchor, setHoveredAnchor] = useState(null);

  // Smart Join state
  const [showSmartJoinModal, setShowSmartJoinModal] = useState(false);
  const [smartJoinWarning, setSmartJoinWarning] = useState('');

  // Guided Smart Join state
  const [showGuidedJoinModal, setShowGuidedJoinModal] = useState(false);
  const [guidedJoinData, setGuidedJoinData] = useState({
    inputNodes: [],
    transformNodes: [],
    outputNodes: [],
    inputMappings: {}, // inputId -> transformId
    fanInSelection: { upstreamTransforms: [], downstreamTransform: null },
    finalOutput: null
  });
  const [guidedJoinStep, setGuidedJoinStep] = useState(1);
  const [guidedJoinErrors, setGuidedJoinErrors] = useState([]);

  // Initialize context values from job when it's loaded
  useEffect(() => {
    if (job?.context?.Default) {
      const initialValues = {};
      Object.entries(job.context.Default).forEach(([key, contextItem]) => {
        initialValues[key] = contextItem.value;
      });
      setContextValues(initialValues);
    }
  }, [job]);

  // Delete node with cascade delete of connections
  const handleDeleteNode = useCallback((nodeId) => {
    if (!job || !nodeId) return;

    console.log(`Deleting node: ${nodeId}`); // Debug log

    // Remove the component and all related flows
    const updatedComponents = job.components.filter(component => component.id !== nodeId);
    const updatedFlows = (job.flows || []).filter(flow =>
      flow.from !== nodeId && flow.to !== nodeId
    );

    const updatedJob = {
      ...job,
      components: updatedComponents,
      flows: updatedFlows
    };

    updateJob(updatedJob);
    setSelectedNodeId(null); // Clear selection
  }, [job, updateJob]);

  // Handle clear canvas with proper callback
  const handleClearCanvas = useCallback(() => {
    if (!job) return;

    console.log('Clearing canvas - before:', { components: job.components?.length, flows: job.flows?.length });

    // Create a completely clean job by preserving only essential properties and clearing arrays
    const clearedJob = {
      ...job,
      components: [],
      flows: [],
      subjobs: {},
      triggers: []
    };

    // Force complete replacement by using loadJob instead of updateJob
    loadJob(clearedJob);
    setSelectedNodeId(null); // Clear any selection
    console.log('Canvas cleared successfully');
  }, [job, loadJob]);

  // Keyboard event listener for delete functionality
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Only handle delete if a node is selected and we're not in an input field
      if ((e.key === 'Delete' || e.key === 'Backspace') &&
          selectedNodeId &&
          !['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
        e.preventDefault();
        handleDeleteNode(selectedNodeId);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedNodeId, handleDeleteNode]); // Add handleDeleteNode to dependencies

  /**
   * SMART JOIN IMPLEMENTATION
   * Auto-connects nodes based on category priority and numeric suffix ordering
   */
  const handleSmartJoin = useCallback(() => {
    if (!job || !job.components || job.components.length === 0) {
      return;
    }

    console.log('=== SMART JOIN STARTED ===');
    console.log('Available components:', job.components.map(c => ({ id: c.id, type: c.original_type || c.type })));

    // Step 1: Collect nodes that don't have outgoing connections
    const existingFlows = job.flows || [];
    const componentsWithOutgoing = new Set(existingFlows.map(flow => flow.from));

    const availableNodes = job.components.filter(component =>
      !componentsWithOutgoing.has(component.id)
    );

    console.log('Nodes without outgoing connections:', availableNodes.map(c => c.id));

    if (availableNodes.length < 2) {
      setSmartJoinWarning('At least 2 unconnected components are required for Smart Join.');
      setShowSmartJoinModal(true);
      return;
    }

    // Step 2: Load component registry for categorization
    const getComponentCategory = (component) => {
      // Fix the component type mapping - only remove leading 't' if it exists
      let componentType = component.original_type?.toLowerCase() || component.type?.toLowerCase() || 'unknown';

      // Only remove leading 't' (for Talend components like tFileInputDelimited -> file_input_delimited)
      if (componentType.startsWith('t') && componentType.length > 1) {
        componentType = componentType.substring(1);
      }

      // DEBUG: Log component type detection
      console.log(`Component ${component.id}: original_type="${component.original_type}", type="${component.type}", mapped="${componentType}"`);

      // Load component registry data (simplified inline registry)
      const registry = {
        'file_input_delimited': { category: 'Input' },
        'fileinputdelimited': { category: 'Input' }, // Alternative mapping
        'oracle_input': { category: 'Input' },
        'oracleinput': { category: 'Input' },
        'mssql_input': { category: 'Input' },
        'mssqlinput': { category: 'Input' },
        'fixed_flow_input': { category: 'Input' },
        'fixedflowinput': { category: 'Input' },
        'row_generator': { category: 'Input' },
        'rowgenerator': { category: 'Input' },
        'filter_rows': { category: 'Transform' },
        'filterrows': { category: 'Transform' },
        'map': { category: 'Transform' },
        'aggregate_row': { category: 'Transform' },
        'aggregaterow': { category: 'Transform' },
        'unique_row': { category: 'Transform' },
        'uniquerow': { category: 'Transform' },
        'join': { category: 'Transform' },
        'unite': { category: 'Transform' },
        'sort_row': { category: 'Transform' },
        'sortrow': { category: 'Transform' },
        'file_output_delimited': { category: 'Output' },
        'fileoutputdelimited': { category: 'Output' }, // Alternative mapping
        'oracle_output': { category: 'Output' },
        'oracleoutput': { category: 'Output' },
        'file_output_positional': { category: 'Output' },
        'fileoutputpositional': { category: 'Output' }
      };

      const categoryInfo = registry[componentType] || { category: 'Transform' };
      console.log(`Component ${component.id} categorized as: ${categoryInfo.category}`);
      return categoryInfo.category;
    };

    // Step 3: Extract numeric suffix from component ID for ordering
    const getNumericSuffix = (componentId) => {
      const match = componentId.match(/_(\d+)$/);
      return match ? parseInt(match[1], 10) : 0;
    };

    // Step 4: Sort nodes by category priority and numeric suffix
    const categoryPriority = { 'Input': 1, 'Transform': 2, 'Output': 3 };

    const sortedNodes = availableNodes.sort((a, b) => {
      const categoryA = getComponentCategory(a);
      const categoryB = getComponentCategory(b);

      // First by category priority
      const priorityDiff = (categoryPriority[categoryA] || 2) - (categoryPriority[categoryB] || 2);
      if (priorityDiff !== 0) return priorityDiff;

      // Then by numeric suffix
      return getNumericSuffix(a.id) - getNumericSuffix(b.id);
    });

    console.log('Sorted nodes:', sortedNodes.map(c => ({
      id: c.id,
      category: getComponentCategory(c),
      suffix: getNumericSuffix(c.id)
    })));

    // Step 5: Ambiguous Case Detection (Mandatory Guardrail)
    const inputNodes = sortedNodes.filter(node => getComponentCategory(node) === 'Input');
    const outputNodes = sortedNodes.filter(node => getComponentCategory(node) === 'Output');

    // DEBUG: Log categorization results
    console.log('Input nodes:', inputNodes.map(n => ({ id: n.id, category: getComponentCategory(n) })));
    console.log('Output nodes:', outputNodes.map(n => ({ id: n.id, category: getComponentCategory(n) })));
    console.log('Ambiguity check:', { totalNodes: sortedNodes.length, inputs: inputNodes.length, outputs: outputNodes.length });

    if (sortedNodes.length > 5 || inputNodes.length > 1 || outputNodes.length > 1) {
      // Store data for potential guided join
      const transformNodes = sortedNodes.filter(node => getComponentCategory(node) === 'Transform');
      setGuidedJoinData({
        inputNodes,
        transformNodes,
        outputNodes,
        inputMappings: {},
        fanInSelection: { upstreamTransforms: [], downstreamTransform: null },
        finalOutput: outputNodes.length === 1 ? outputNodes[0].id : null
      });

      setSmartJoinWarning('Multiple execution paths detected. Please define sequence manually.');
      setShowSmartJoinModal(true);
      console.log('=== SMART JOIN ABORTED - AMBIGUOUS CASE ===');
      return;
    }

    // Step 6: Auto Join (Simple Case)
    console.log('Proceeding with auto join - Input/Output validation passed');
    if (inputNodes.length === 1 && outputNodes.length === 1) {
      console.log('Single input/output detected - creating connections');
      const newFlows = [];

      // Create sequential connections
      for (let i = 0; i < sortedNodes.length - 1; i++) {
        const sourceNode = sortedNodes[i];
        const targetNode = sortedNodes[i + 1];

        console.log(`Processing connection: ${sourceNode.id} (${getComponentCategory(sourceNode)}) -> ${targetNode.id} (${getComponentCategory(targetNode)})`);

        // Validate connection using component registry
        const sourceCategory = getComponentCategory(sourceNode);
        const targetCategory = getComponentCategory(targetNode);

        // Basic validation rules
        if (targetCategory === 'Input') {
          console.warn(`Skipping invalid connection: ${sourceNode.id} -> ${targetNode.id} (cannot connect to Input)`);
          continue;
        }

        if (sourceCategory === 'Output') {
          console.warn(`Skipping invalid connection: ${sourceNode.id} -> ${targetNode.id} (Output cannot connect to anything)`);
          continue;
        }

        // Check if connection already exists
        const connectionExists = existingFlows.some(flow =>
          flow.from === sourceNode.id && flow.to === targetNode.id
        );

        if (!connectionExists) {
          const newFlow = {
            name: 'main',
            from: sourceNode.id,
            to: targetNode.id,
            type: 'flow'
          };
          newFlows.push(newFlow);

          console.log(`Creating connection: ${sourceNode.id} -> ${targetNode.id}`, newFlow);
        } else {
          console.log(`Connection already exists: ${sourceNode.id} -> ${targetNode.id}`);
        }
      }

      console.log('New flows to create:', newFlows);
      console.log('Existing flows:', existingFlows);

      if (newFlows.length > 0) {
        // Update job with new flows
        const updatedJob = {
          ...job,
          flows: [...existingFlows, ...newFlows]
        };

        console.log('Updating job with flows:', updatedJob.flows);
        updateJob(updatedJob);
        console.log('=== SMART JOIN COMPLETED ===');
        console.log('Created flows:', newFlows);
      } else {
        console.log('No flows to create');
        setSmartJoinWarning('No new connections could be created. Components may already be connected.');
        setShowSmartJoinModal(true);
      }
    }
  }, [job, updateJob, setSmartJoinWarning, setShowSmartJoinModal, setGuidedJoinData]);

  // FlowGenie Smart Join event listener
  useEffect(() => {
    const handleFlowGenieSmartJoin = () => {
      console.log('FlowCanvas: Received FlowGenie Smart Join trigger');
      handleSmartJoin();
    };

    window.addEventListener('flowgenie-smart-join', handleFlowGenieSmartJoin);

    return () => {
      window.removeEventListener('flowgenie-smart-join', handleFlowGenieSmartJoin);
    };
  }, [handleSmartJoin]);

  // Handle node selection (update existing handleMouseDown logic)
  const handleNodeClick = (componentId) => {
    console.log('Selecting node:', componentId); // Debug log
    setSelectedNodeId(componentId);
    if (onComponentClick) {
      onComponentClick(componentId);
    }
  };

  // Handle context value updates
  const updateContextValue = (contextName, newValue) => {
    setContextValues(prev => ({
      ...prev,
      [contextName]: newValue
    }));
  };

  // Handle job execution
  const handleExecuteJob = async () => {
    try {
      // Clear previous results
      clearExecutionResults();

      // Use current context values from the Context tab
      await executeJob(contextValues);

      // Switch to Log tab to show results
      setActiveTab('Log');
    } catch (error) {
      console.error('Job execution failed:', error);
      // Error will be shown in the execution state
    }
  };

  // Handle output file download
  const handleDownloadOutput = async () => {
    try {
      await downloadOutputFile();
    } catch (error) {
      console.error('Download failed:', error);
      alert(`Download failed: ${error.message}`);
    }
  };

  // Handle toggle active state
  const handleToggleActive = (e, componentId) => {
    e.stopPropagation(); // Prevent triggering drag/select
    const component = job.components.find(c => c.id === componentId);
    if (component) {
      updateComponentData(componentId, { active: !component.active });
    }
  };

  useEffect(() => {
    const savedTheme = localStorage.getItem('rectran-theme');
    if (savedTheme === 'light') {
      setIsDarkMode(false);
      document.body.classList.add('light-mode');
    }
  }, []);

  const toggleTheme = () => {
    setIsDarkMode(!isDarkMode);
    if (isDarkMode) {
      document.body.classList.add('light-mode');
      localStorage.setItem('rectran-theme', 'light');
    } else {
      document.body.classList.remove('light-mode');
      localStorage.setItem('rectran-theme', 'dark');
    }
  };

  // Collision-avoidance: Apply minimal Y offsets to prevent visual overlap
  // Does not modify source JSON data, only adjusts render positions
  const applyCollisionAvoidance = (components) => {
    if (!components || components.length === 0) return components;

    const NODE_WIDTH = 140;   // Based on CSS flow-node width (updated)
    const NODE_HEIGHT = 80;   // Based on CSS flow-node height
    const MIN_OFFSET = 40;    // Increased spacing for more Talend-like layout

    // Create a copy for render positions without modifying original data
    const adjustedComponents = components.map(comp => ({
      ...comp,
      renderPosition: { ...comp.position } // Start with original positions
    }));

    // Check for overlaps and apply minimal Y offsets
    for (let i = 0; i < adjustedComponents.length; i++) {
      for (let j = i + 1; j < adjustedComponents.length; j++) {
        const nodeA = adjustedComponents[i];
        const nodeB = adjustedComponents[j];

        const aLeft = nodeA.renderPosition.x;
        const aRight = aLeft + NODE_WIDTH;
        const aTop = nodeA.renderPosition.y;
        const aBottom = aTop + NODE_HEIGHT;

        const bLeft = nodeB.renderPosition.x;
        const bRight = bLeft + NODE_WIDTH;
        const bTop = nodeB.renderPosition.y;
        const bBottom = bTop + NODE_HEIGHT;

        // Check if bounding boxes overlap
        const xOverlap = aLeft < bRight && aRight > bLeft;
        const yOverlap = aTop < bBottom && aBottom > bTop;

        if (xOverlap && yOverlap) {
          // Apply minimal Y offset to the node with higher original Y position
          if (nodeB.position.y >= nodeA.position.y) {
            nodeB.renderPosition.y = aBottom + MIN_OFFSET;
          } else {
            nodeA.renderPosition.y = bBottom + MIN_OFFSET;
          }
        }
      }
    }

    return adjustedComponents;
  };

  const handleMouseDown = (e, componentId) => {
    console.log('Mouse down on component:', componentId); // Debug log
    e.preventDefault();

    const component = job.components.find(c => c.id === componentId);
    if (!component) return;

    const startTime = Date.now();
    let hasMoved = false;

    dragState.current = {
      componentId,
      startX: e.clientX,
      startY: e.clientY,
      originalPosition: { ...component.position }
    };

    const handleMouseMove = (e) => {
      if (!dragState.current) return;

      const deltaX = e.clientX - dragState.current.startX;
      const deltaY = e.clientY - dragState.current.startY;

      // Consider it a drag if moved more than 5 pixels
      if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
        hasMoved = true;
        console.log('Mouse move - dragging component:', dragState.current.componentId); // Debug log

        const newPosition = {
          x: dragState.current.originalPosition.x + deltaX,
          y: dragState.current.originalPosition.y + deltaY
        };

        console.log('Updating position to:', newPosition); // Debug log
        updateComponentData(dragState.current.componentId, { position: newPosition });
      }
    };

    const handleMouseUp = (e) => {
      console.log('Mouse up - ending drag'); // Debug log

      // If we haven't moved and it was a quick click, treat as selection
      const clickDuration = Date.now() - startTime;
      if (!hasMoved && clickDuration < 300) {
        console.log('Treating as click - selecting component'); // Debug log
        handleNodeClick(componentId);
      }

      dragState.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleDrawerClick = (e) => {
    e.preventDefault();

    // Clear any existing timeout
    if (clickTimeout.current) {
      clearTimeout(clickTimeout.current);
      clickTimeout.current = null;
    }

      // Set a timeout to handle single click
    clickTimeout.current = setTimeout(() => {
      // Single click logic
      if (drawerLevel === 0) {
        setDrawerLevel(1);
      } else if (drawerLevel === 1) {
        setDrawerLevel(0);
      } else if (drawerLevel === 2) {
        setDrawerLevel(0);
      }
      clickTimeout.current = null;
    }, 250);
  };

  const handleDrawerDoubleClick = (e) => {
    e.preventDefault();

    // Clear the single click timeout
    if (clickTimeout.current) {
      clearTimeout(clickTimeout.current);
      clickTimeout.current = null;
    }

    // Double click logic
    if (drawerLevel === 1) {
      setDrawerLevel(2);
    }
    // Do nothing for other levels
  };

  // Handle flow connection creation
  const handleAnchorMouseDown = (e, componentId, port, anchorType) => {
    e.stopPropagation();

    if (anchorType !== 'output') return; // Only start connections from outputs

    const rect = e.target.getBoundingClientRect();
    const canvasRect = e.target.closest('.flow-viewport').getBoundingClientRect();

setConnectionDragState({
  isDragging: true,
  sourceComponentId: componentId,
  sourcePort: port,
  currentX: rect.left - canvasRect.left + rect.width / 2,
  currentY: rect.top - canvasRect.top + rect.height / 2
});

const handleMouseMove = (e) => {
  const canvasRect = e.target.closest('.flow-viewport')?.getBoundingClientRect() ||
                     document.querySelector('.flow-viewport').getBoundingClientRect();

  setConnectionDragState(prev => ({
    ...prev,
    currentX: e.clientX - canvasRect.left,
    currentY: e.clientY - canvasRect.top
  }));
};

const handleMouseUp = (e) => {
  setConnectionDragState({
    isDragging: false,
    sourceComponentId: null,
    sourcePort: null,
    currentX: 0,
    currentY: 0
  });

  document.removeEventListener('mousemove', handleMouseMove);
  document.removeEventListener('mouseup', handleMouseUp);
};

document.addEventListener('mousemove', handleMouseMove);
document.addEventListener('mouseup', handleMouseUp);
};

const handleAnchorMouseUp = (e, targetComponentId, targetPort, anchorType) => {
  if (!connectionDragState.isDragging || anchorType !== 'input') return;

  e.stopPropagation();

// Validate connection
  if (connectionDragState.sourceComponentId === targetComponentId) {
    return; // Can't connect to self
  }

// Check if connection already exists
  const existingConnection = job.flows?.find(flow =>
    flow.from === connectionDragState.sourceComponentId &&
    flow.to === targetComponentId
  );

  if (existingConnection) {
    return; // Connection already exists
  }

    // Create new flow
  const newFlow = {
    name: `${connectionDragState.sourcePort || 'main'}`,
    from: connectionDragState.sourceComponentId,
    to: targetComponentId,
    type: 'flow'
  };

  // Add flow to job
  const updatedJob = {
    ...job,
    flows: [...(job.flows || []), newFlow]
  };

  updateJob(updatedJob);
};

const getAnchorPosition = (component, port, anchorType) => {
  if (!component.renderPosition) return { x: 0, y: 0 };

  const nodeWidth = 140;
  const nodeHeight = 80;
  const anchorSize = 8;

  if (anchorType === 'input') {
    return {
      x: component.renderPosition.x - anchorSize / 2,
      y: component.renderPosition.y + nodeHeight / 2 - anchorSize / 2
    };
  } else {
    return {
      x: component.renderPosition.x + nodeWidth - anchorSize / 2,
      y: component.renderPosition.y + nodeHeight / 2 - anchorSize / 2
    };
  }
};

// Get component registry info
const getComponentRegistryInfo = (component) => {
  // Load from component registry based on component type
  try {
    // Import the registry data synchronously
    const registry = {
      "file_input_delimited": { inputs: [], outputs: ["main"] },
      "file_output_delimited": { inputs: ["main"], outputs: ["main"] },
      "map": { inputs: ["main"], outputs: ["main"] },
      "filter_rows": { inputs: ["main"], outputs: ["main", "reject"] },
      "aggregate_row": { inputs: ["main"], outputs: ["main", "reject"] },
      "unique_row": { inputs: ["main"], outputs: ["main"] },
      "oracle_input": { inputs: [], outputs: ["main", "reject"] },
      "oracle_output": { inputs: ["main"], outputs: [] },
      "join": { inputs: ["main", "lookup"], outputs: ["main", "reject"] },
      "unite": { inputs: ["main", "lookup"], outputs: ["main"] },
      "log_row": { inputs: ["main"], outputs: ["main"] },
      "python_component": { inputs: [], outputs: ["main"] },
      "die": { inputs: ["main"], outputs: [] },
      "warn": { inputs: ["main"], outputs: ["main"] }
    };

    // Map original_type to registry key
    const componentKey = component.original_type?.toLowerCase().replace('t', '') ||
                        component.type?.toLowerCase() || 'default';

    return registry[componentKey] || { inputs: ["main"], outputs: ["main"] };
  } catch (error) {
    // Fallback to defaults
    return { inputs: ["main"], outputs: ["main"] };
  }
};

  /**
 * NEW PROJECT DETECTION
 * Smart Join is only visible for new projects:
 * - Project created through "New Job" wizard (not loaded from file)
 * - Check if job has the characteristics of a freshly created job
 */
const isNewProject = () => {
  if (!job) return false;

  // New project detection:
  // 1. Job was created through wizard (has feeds property or no flows yet)
  // 2. OR job has components but no existing flows (user added components manually)
  const hasNoFlows = !job.flows || job.flows.length === 0;
  const isWizardCreated = job.hasOwnProperty('feeds') || job.hasOwnProperty('reconId');

  // If it's a wizard-created job OR has components but no flows yet, it's a new project
  return isWizardCreated || (job.components.length > 0 && hasNoFlows);
};

// Guided Smart Join functions
const handleInputMappingChange = (inputId, transformId) => {
  setGuidedJoinData(prev => ({
    ...prev,
    inputMappings: {
      ...prev.inputMappings,
      [inputId]: transformId
    }
  }));
};

const handleFanInSelectionChange = (type, value) => {
  setGuidedJoinData(prev => ({
    ...prev,
    fanInSelection: {
      ...prev.fanInSelection,
      [type]: value
    }
  }));
};


