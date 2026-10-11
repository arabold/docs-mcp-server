{{- define "docs-mcp-server.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- define "docs-mcp-server.fullname" -}}
{{- if .Values.fullnameOverride }}{{ .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}{{- $name := default .Chart.Name .Values.nameOverride }}{{- if contains $name .Release.Name }}{{ .Release.Name | trunc 63 | trimSuffix "-" }}{{- else }}{{ printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}{{- end }}{{- end }}
{{- end }}
{{- define "docs-mcp-server.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- define "docs-mcp-server.selectorLabels" -}}
app.kubernetes.io/name: {{ include "docs-mcp-server.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
{{- define "docs-mcp-server.labels" -}}
helm.sh/chart: {{ include "docs-mcp-server.chart" . }}
{{ include "docs-mcp-server.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}
{{- define "docs-mcp-server.serviceAccountName" -}}
{{- $serviceAccount := .Values.serviceAccount | default dict -}}
{{- $enabled := dig "enabled" true $serviceAccount -}}
{{- $create := dig "create" true $serviceAccount -}}
{{- if and $enabled $create }}{{ default (include "docs-mcp-server.fullname" .) (get $serviceAccount "name") }}{{- else }}default{{- end }}
{{- end }}
{{- define "docs-mcp-server.hasDataVolumeMount" -}}
{{- range (.Values.extraVolumeMounts | default list) }}{{- if eq .mountPath "/data" }}true{{- end }}{{- end }}
{{- end }}
{{- define "docs-mcp-server.hasConfigVolumeMount" -}}
{{- range (.Values.extraVolumeMounts | default list) }}{{- if eq .mountPath "/config" }}true{{- end }}{{- end }}
{{- end }}
{{- define "docs-mcp-server.image" -}}
{{- if .Values.image.digest }}{{ printf "%s@%s" .Values.image.repository .Values.image.digest }}{{- else }}{{ printf "%s:%s" .Values.image.repository (default .Chart.AppVersion .Values.image.tag) }}{{- end }}
{{- end }}
{{- define "docs-mcp-server.dataClaimName" -}}
{{- default (printf "%s-data" (include "docs-mcp-server.fullname" .)) (get (.Values.dataPersistence | default dict) "existingClaim") }}
{{- end }}
{{- define "docs-mcp-server.podSecurityContext" -}}
{{- toYaml .Values.podSecurityContext -}}
{{- end }}
{{- define "docs-mcp-server.configClaimName" -}}
{{- default (printf "%s-config" (include "docs-mcp-server.fullname" .)) (get (.Values.configPersistence | default dict) "existingClaim") }}
{{- end }}
