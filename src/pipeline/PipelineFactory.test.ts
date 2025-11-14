import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentManagementService } from "../store";
import { PipelineClient } from "./PipelineClient";
import { PipelineFactory } from "./PipelineFactory";
import { PipelineManager } from "./PipelineManager";

// Mock dependencies
vi.mock("./PipelineManager");
vi.mock("./PipelineClient");

describe("PipelineFactory", () => {
  let mockDocService: Partial<DocumentManagementService>;

  beforeEach(() => {
    vi.resetAllMocks();
    mockDocService = {};
  });

  describe("createPipeline", () => {
    it("should create PipelineManager when no serverUrl provided", async () => {
      const options = { concurrency: 5, recoverJobs: true };

      const pipeline = await PipelineFactory.createPipeline(
        mockDocService as DocumentManagementService,
        options,
      );

      expect(PipelineManager).toHaveBeenCalledWith(mockDocService, 5, {
        recoverJobs: true,
      });
      expect(PipelineClient).not.toHaveBeenCalled();
      // Behavior: returned instance is the one constructed by PipelineManager
      const ManagerMock = PipelineManager as unknown as { mock: { instances: any[] } };
      expect(pipeline).toBe(ManagerMock.mock.instances[0]);
    });

    it("should create PipelineClient when serverUrl provided", async () => {
      const options = { serverUrl: "http://localhost:8080", concurrency: 3 };

      const pipeline = await PipelineFactory.createPipeline(
        mockDocService as DocumentManagementService,
        options,
      );

      expect(PipelineClient).toHaveBeenCalledWith("http://localhost:8080");
      expect(PipelineManager).not.toHaveBeenCalled();
      // Behavior: returned instance is the one constructed by PipelineClient
      const ClientMock = PipelineClient as unknown as { mock: { instances: any[] } };
      expect(pipeline).toBe(ClientMock.mock.instances[0]);
    });

    it("should use default options when none provided", async () => {
      await PipelineFactory.createPipeline(mockDocService as DocumentManagementService);

      expect(PipelineManager).toHaveBeenCalledWith(mockDocService, 3, {
        recoverJobs: false,
      });
    });

    it("should prioritize serverUrl over other options", async () => {
      const options = {
        serverUrl: "http://external:9000",
        concurrency: 10,
        recoverJobs: true,
      };

      await PipelineFactory.createPipeline(
        mockDocService as DocumentManagementService,
        options,
      );

      // Should create client, ignoring local pipeline options
      expect(PipelineClient).toHaveBeenCalledWith("http://external:9000");
      expect(PipelineManager).not.toHaveBeenCalled();
    });
  });
});
