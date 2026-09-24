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
{{- if .Values.serviceAccount.create }}{{ default (include "docs-mcp-server.fullname" .) .Values.serviceAccount.name }}{{- else }}{{ default "default" .Values.serviceAccount.name }}{{- end }}
{{- end }}
{{- define "docs-mcp-server.image" -}}
{{- if .Values.image.digest }}{{ printf "%s@%s" .Values.image.repository .Values.image.digest }}{{- else }}{{ printf "%s:%s" .Values.image.repository (default .Chart.AppVersion .Values.image.tag) }}{{- end }}
{{- end }}
{{- define "docs-mcp-server.dataClaimName" -}}
{{- default (printf "%s-data" (include "docs-mcp-server.fullname" .)) .Values.dataPersistence.existingClaim }}
{{- end }}
{{- define "docs-mcp-server.podSecurityContext" -}}
{{- $context := deepCopy .Values.podSecurityContext -}}
{{- if and (not .Values.openshift.enabled) (not (hasKey $context "fsGroup")) -}}
{{- $_ := set $context "fsGroup" 1000 -}}
{{- end -}}
{{- toYaml $context -}}
{{- end }}
{{- define "docs-mcp-server.configClaimName" -}}
{{- default (printf "%s-config" (include "docs-mcp-server.fullname" .)) .Values.configPersistence.existingClaim }}
{{- end }}
