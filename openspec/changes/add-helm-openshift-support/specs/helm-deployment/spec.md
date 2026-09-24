# Spec Delta

## Purpose

Provides a supported, configurable installation of the unified Docs MCP Server container on Kubernetes and OpenShift clusters.

## ADDED Requirements

### Requirement: Unified Helm installation
The project SHALL provide a Helm chart that deploys one unified Docs MCP Server workload and exposes its HTTP interface through a cluster Service.

#### Scenario: Default installation
- **WHEN** an operator installs the chart with its default values
- **THEN** the cluster runs one non-root application workload backed by a Service
- **AND** the application listens on the Service's configured HTTP port

### Requirement: Persistent runtime storage
The chart SHALL independently configure the application's data and configuration storage as chart-created persistent claims, existing claims, or ephemeral volumes.

#### Scenario: Chart-managed persistence
- **WHEN** an operator enables chart-managed persistence for data and configuration
- **THEN** the release creates and mounts storage at both application runtime paths

#### Scenario: Existing claims
- **WHEN** an operator supplies existing claims for data and configuration
- **THEN** the workload mounts those claims without creating replacements

### Requirement: Restricted-platform security configuration
The chart SHALL run without requiring a fixed user ID, root privileges, privilege escalation, or added Linux capabilities, while allowing cluster-specific pod and container security settings to be supplied.

#### Scenario: OpenShift assigns an identity
- **WHEN** an OpenShift security policy assigns an arbitrary non-root user and permitted supplemental groups
- **THEN** the rendered workload does not override that assignment with a fixed user ID or forbidden group

#### Scenario: Storage requires a supplemental group
- **WHEN** an operator configures a permitted supplemental filesystem group
- **THEN** the rendered workload requests that group for mounted storage

### Requirement: Optional external exposure
The chart SHALL optionally expose the Service through either a Kubernetes Ingress or an OpenShift Route, with both resources disabled by default.

#### Scenario: OpenShift Route enabled
- **WHEN** an operator enables the Route and supplies its exposure settings
- **THEN** the release renders a Route targeting the chart's HTTP Service port

#### Scenario: External exposure disabled
- **WHEN** neither Ingress nor Route is enabled
- **THEN** the release exposes the application only through its cluster Service

### Requirement: Operator-supplied extra resources
The chart SHALL accept a list of additional Kubernetes resource definitions and render each definition in the release with Helm template expressions evaluated in the release context.

#### Scenario: Extra resource supplied
- **WHEN** an operator supplies an additional resource that references release values
- **THEN** the rendered release contains that resource with the references resolved

#### Scenario: No extra resources supplied
- **WHEN** the extra-resource list is empty
- **THEN** the chart renders no additional resource documents
