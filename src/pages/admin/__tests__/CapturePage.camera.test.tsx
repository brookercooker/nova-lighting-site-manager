import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CapturePage from "../CapturePage";
import CameraCaptureSheet from "../CameraCaptureSheet";

const mocks = vi.hoisted(() => ({ info: vi.fn(), upload: vi.fn() }));
vi.mock("sonner", () => ({ toast: { info: mocks.info, error: vi.fn(), success: vi.fn() } }));
vi.mock("../useAdminData", () => ({ usePages: () => ({ data: [] }) }));
vi.mock("../LabelPicker", () => ({ default: () => null }));
vi.mock("../captureUpload", () => ({
  uploadImageFile: mocks.upload, uploadVideoFile: vi.fn(), attachPageUsages: vi.fn(),
  uniqueName: (name: string, taken: Set<string>) => {
    let result = name, n = 1;
    while (taken.has(result)) result = name.replace(/\.jpg$/, `-${n++}.jpg`);
    return result;
  },
}));

let stop: ReturnType<typeof vi.fn>;
let getUserMedia: ReturnType<typeof vi.fn>;
let stream: MediaStream;
let drawImage: ReturnType<typeof vi.fn>;
let toBlob: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stop = vi.fn();
  stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
  getUserMedia = vi.fn().mockResolvedValue(stream);
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
    getUserMedia, enumerateDevices: vi.fn().mockResolvedValue([{ kind: "videoinput" }, { kind: "videoinput" }]),
  } });
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(4096);
  vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(2160);
  drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
  toBlob = vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (callback) {
    expect(this.width).toBe(4096);
    expect(this.height).toBe(2160);
    callback(new Blob(["jpeg"], { type: "image/jpeg" }));
  });
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:photo") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  mocks.info.mockClear();
  mocks.upload.mockReset().mockResolvedValue({ id: "photo" });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function openPage() {
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><CapturePage /></MemoryRouter></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: /^Take Photo$/ }));
}
async function readyCamera() {
  await waitFor(() => expect(screen.getByRole("button", { name: "Take Picture" })).toBeEnabled());
}

describe("Capture live camera", () => {
  it("sanitizes an edited name before uploading", async () => {
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><CapturePage /></MemoryRouter></QueryClientProvider>);
    fireEvent.change(screen.getByLabelText("Choose Photos or Videos"), { target: { files: [new File(["jpeg"], "original.jpg", { type: "image/jpeg" })] } });
    const input = screen.getByRole("textbox", { name: "Name for original.jpg" });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);
    expect(input).toHaveValue("original.jpg");
    fireEvent.change(input, { target: { value: "a/b\\c" } });
    fireEvent.click(screen.getByRole("button", { name: "Upload 1" }));
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledWith(expect.any(File), expect.objectContaining({ filename: "abc" })));
  });
  it("requires confirmation before removing multiple staged items", () => {
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><CapturePage /></MemoryRouter></QueryClientProvider>);
    fireEvent.change(screen.getByLabelText("Choose Photos or Videos"), { target: { files: [new File(["a"], "one.jpg", { type: "image/jpeg" }), new File(["b"], "two.jpg", { type: "image/jpeg" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByRole("button", { name: "Upload 2", hidden: true })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Upload 2" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove All" }));
    expect(screen.queryByRole("button", { name: "Upload 2" })).toBeNull();
  });
  it("guards leaving and reloads only while unuploaded items remain", () => {
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><CapturePage /></MemoryRouter></QueryClientProvider>);
    fireEvent.change(screen.getByLabelText("Choose Photos or Videos"), { target: { files: [new File(["a"], "one.jpg", { type: "image/jpeg" })] } });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("link", { name: /Site Manager/ }));
    expect(confirm).toHaveBeenCalledOnce();
    const reload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(reload);
    expect(reload.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    const cleanReload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(cleanReload);
    expect(cleanReload.defaultPrevented).toBe(false);
  });
  it("owns the Capture title while mounted and releases title ownership on leaving", () => {
    const view = render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><CapturePage /></MemoryRouter></QueryClientProvider>);
    expect(document.title).toBe("Capture · Site Manager");
    document.title = "Nova Lighting — Designer Lighting for the Home";
    expect(document.title).toBe("Capture · Site Manager");
    view.unmount();
    document.title = "Images · Site Manager";
    expect(document.title).toBe("Images · Site Manager");
    expect(getUserMedia).not.toHaveBeenCalled();
  });
  it("opens Take Photo directly and stages repeated native-resolution JPEG shots without uploading", async () => {
    const picker = vi.spyOn(HTMLInputElement.prototype, "click");
    openPage();
    await readyCamera();
    expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: { ideal: "environment" }, width: { ideal: 4096 }, height: { ideal: 2160 } }, audio: false });
    expect(picker).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Take Picture" }));
    fireEvent.click(screen.getByRole("button", { name: "Take Picture" }));
    expect(screen.getByText("2 taken")).toBeInTheDocument();
    expect(drawImage).toHaveBeenCalledWith(screen.getByLabelText("Live Camera"), 0, 0, 4096, 2160);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.92);
    const captured = vi.mocked(URL.createObjectURL).mock.calls[0]?.[0];
    expect(captured).toBeInstanceOf(File);
    expect((captured as File).name).toMatch(/^photo-\d{8}-\d{6}\.jpg$/);
    expect((captured as File).type).toBe("image/jpeg");
    expect(mocks.upload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^Done$/ }));
    expect(screen.getByText(/Staged · 2 items/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload 2" })).toBeEnabled();
    expect(stop).toHaveBeenCalled();
  });

  it.each(["NotAllowedError", "NotFoundError", "NotReadableError"])("falls back to single-photo input for %s", async (name) => {
    getUserMedia.mockRejectedValue(new DOMException("camera failed", name));
    const picker = vi.spyOn(HTMLInputElement.prototype, "click");
    openPage();
    await waitFor(() => expect(picker).toHaveBeenCalledOnce());
    expect(picker.mock.instances[0]).toBe(screen.getByLabelText("Take a Photo"));
    expect(screen.getByLabelText("Take a Photo")).toHaveAttribute("accept", "image/*");
    expect(screen.getByLabelText("Take a Photo")).toHaveAttribute("capture", "environment");
    expect(screen.getByLabelText("Take a Photo")).not.toHaveAttribute("multiple");
    expect(mocks.info).toHaveBeenCalledWith(expect.stringContaining(name === "NotAllowedError" ? "Camera access was blocked" : name === "NotFoundError" ? "No camera was found" : "couldn't be started"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("falls back when mediaDevices is missing", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    const picker = vi.spyOn(HTMLInputElement.prototype, "click");
    openPage();
    await waitFor(() => expect(picker).toHaveBeenCalledOnce());
    expect(mocks.info).toHaveBeenCalledWith(expect.stringContaining("isn't available"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps Choose Files as the multiple image and video picker", () => {
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><CapturePage /></MemoryRouter></QueryClientProvider>);
    const picker = vi.spyOn(HTMLInputElement.prototype, "click");
    fireEvent.click(screen.getByRole("button", { name: "Choose Files" }));
    expect(picker.mock.instances[0]).toBe(screen.getByLabelText("Choose Photos or Videos"));
    expect(screen.getByLabelText("Choose Photos or Videos")).toHaveAttribute("multiple");
    expect(screen.getByLabelText("Choose Photos or Videos")).toHaveAttribute("accept", "image/*,video/*,.webm,.mp4,.mov");
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});

describe("camera stream lifecycle", () => {
  function sheet() {
    const props = { open: true, onOpenChange: vi.fn(), onCapture: vi.fn(), onUnavailable: vi.fn() };
    const rendered = render(<StrictMode><CameraCaptureSheet {...props} /></StrictMode>);
    return { ...rendered, props };
  }
  it("cleans up on close and unmount under StrictMode", async () => {
    const { rerender, unmount, props } = sheet();
    await readyCamera();
    expect(getUserMedia).toHaveBeenCalledOnce();
    rerender(<StrictMode><CameraCaptureSheet {...props} open={false} /></StrictMode>);
    expect(stop).toHaveBeenCalled();
    stop.mockClear();
    rerender(<StrictMode><CameraCaptureSheet {...props} /></StrictMode>);
    await readyCamera();
    unmount();
    expect(stop).toHaveBeenCalled();
  });
  it("stops and closes when the tab becomes hidden", async () => {
    const { props } = sheet();
    await readyCamera();
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    fireEvent(document, new Event("visibilitychange"));
    expect(stop).toHaveBeenCalled();
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });
  it("stops a late stream after closing while permission is pending", async () => {
    let resolve: ((value: MediaStream) => void) | undefined;
    getUserMedia.mockImplementation(() => new Promise<MediaStream>((r) => { resolve = r; }));
    const { unmount, props } = sheet();
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Close Camera" }));
    await act(async () => resolve?.(stream));
    expect(stop).toHaveBeenCalled();
    expect(props.onUnavailable).not.toHaveBeenCalled();
    unmount();
  });
  it("switches cameras after stopping the previous stream", async () => {
    sheet();
    await readyCamera();
    await waitFor(() => expect(screen.getByRole("button", { name: "Flip Camera" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Flip Camera" }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    expect(stop).toHaveBeenCalled();
    expect(getUserMedia.mock.calls[1]?.[0].video.facingMode).toEqual({ ideal: "user" });
  });
  it("hides Flip Camera for a single video input", async () => {
    vi.mocked(navigator.mediaDevices.enumerateDevices).mockResolvedValue([{ kind: "videoinput" } as MediaDeviceInfo]);
    sheet();
    await readyCamera();
    expect(screen.queryByRole("button", { name: "Flip Camera" })).toBeNull();
  });
});