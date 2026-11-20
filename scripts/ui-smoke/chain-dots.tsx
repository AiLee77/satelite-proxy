import { createRoot } from "react-dom/client";
import "../../src/App.css";
import "../../src/pages/ChainPage.css";

const params = new URLSearchParams(location.search);
const theme = params.get("theme") === "day" ? "day" : "aerospace";
document.documentElement.dataset.theme = theme;

// 最小化测试组件：并排渲染样板圆点和编辑池圆点
function DotComparisonTest() {
  return (
    <div style={{ padding: "40px", display: "flex", flexDirection: "column", gap: "40px" }}>
      <div>
        <h3>样板圆点（链卡）</h3>
        <div className="chain-station" style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span className="chain-station-dot entry" />
          <span style={{ fontSize: "14px" }}>entry 样板 (8px)</span>
        </div>
        <div className="chain-station" style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "12px" }}>
          <span className="chain-station-dot exit" />
          <span style={{ fontSize: "14px" }}>exit 样板 (8px)</span>
        </div>
      </div>
      
      <div>
        <h3>编辑池圆点（指定节点模式）</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <label className="chain-pool-node-item" style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <input
              className="chain-pool-select-dot"
              type="checkbox"
              defaultChecked={false}
            />
            <span>未选中的节点</span>
          </label>
          <label className="chain-pool-node-item" style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <input
              className="chain-pool-select-dot"
              type="checkbox"
              defaultChecked={true}
            />
            <span>已选中的节点</span>
          </label>
        </div>
      </div>
      
      <div>
        <h3>编辑池圆点（订阅模式）</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <label className="chain-pool-node-item" style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <input
              className="chain-pool-select-dot"
              type="radio"
              name="test-sub"
            />
            <span>未选订阅</span>
          </label>
          <label className="chain-pool-node-item" style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <input
              className="chain-pool-select-dot"
              type="radio"
              name="test-sub"
              defaultChecked={true}
            />
            <span>已选订阅</span>
          </label>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<DotComparisonTest />);
