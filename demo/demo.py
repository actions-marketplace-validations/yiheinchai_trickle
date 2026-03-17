import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset

# Generate synthetic spiral dataset
def make_spirals(n=1000, noise=0.5):
    t = torch.linspace(0, 4 * 3.14159, n)
    x0 = torch.stack([t * torch.cos(t) + noise * torch.randn(n),
                       t * torch.sin(t) + noise * torch.randn(n)], dim=1)
    x1 = torch.stack([-t * torch.cos(t) + noise * torch.randn(n),
                       -t * torch.sin(t) + noise * torch.randn(n)], dim=1)
    X = torch.cat([x0, x1])
    y = torch.cat([torch.zeros(n), torch.ones(n)])
    return X, y

class SpiralClassifier(nn.Module):
    def __init__(self, dropout=0.2):
        super().__init__()
        # Embed 2D points into a 1D "signal" for conv layers
        self.embed = nn.Linear(2, 256)
        self.bn0 = nn.BatchNorm1d(256)

        # Conv blocks with changing shapes: 16ch -> 32 -> 64 -> 128 -> 64 -> 32
        self.conv1 = nn.Conv1d(16, 32, kernel_size=3, padding=1)
        self.bn1 = nn.BatchNorm1d(32)
        self.conv2 = nn.Conv1d(32, 64, kernel_size=3, padding=1)
        self.ln2 = nn.LayerNorm([64, 16])
        self.conv3 = nn.Conv1d(64, 128, kernel_size=3, padding=1)
        self.bn3 = nn.BatchNorm1d(128)
        self.conv4 = nn.Conv1d(128, 64, kernel_size=3, stride=2)
        self.bn4 = nn.BatchNorm1d(64)
        self.conv5 = nn.Conv1d(64, 32, kernel_size=3, stride=2)
        self.ln5 = nn.LayerNorm([32, 3])

        # Classifier head
        self.fc1 = nn.Linear(32 * 3, 64)
        self.ln6 = nn.LayerNorm(64)
        self.fc2 = nn.Linear(64, 1)

        self.relu = nn.ReLU()
        self.gelu = nn.GELU()
        self.dropout = nn.Dropout(dropout)

    def forward(self, x):
        # Embed: (B, 2) -> (B, 256) -> reshape to (B, 16, 16)
        x = self.relu(self.bn0(self.embed(x)))
        x = x.view(x.size(0), 16, 16)

        # Conv blocks with shape changes
        x = self.relu(self.bn1(self.conv1(x)))       # (B, 32, 16)
        x = self.dropout(x)
        x = self.gelu(self.ln2(self.conv2(x)))        # (B, 64, 16)
        x = self.dropout(x)
        x = self.relu(self.bn3(self.conv3(x)))        # (B, 128, 16)
        x = self.dropout(x)
        x = self.gelu(self.bn4(self.conv4(x)))        # (B, 64, 7)
        x = self.relu(self.ln5(self.conv5(x)))        # (B, 32, 3)

        # Flatten and classify
        x = x.flatten(1)                              # (B, 96)
        x = self.gelu(self.ln6(self.fc1(x)))          # (B, 64)
        x = self.dropout(x)
        return self.fc2(x)                            # (B, 1)

model = SpiralClassifier()

X, y = make_spirals()
loader = DataLoader(TensorDataset(X, y), batch_size=128, shuffle=True)
optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)
loss_fn = nn.BCEWithLogitsLoss()

# Train
for epoch in range(1, 31):
    total_loss, correct = 0.0, 0
    for xb, yb in loader:
        pred = model(xb).squeeze()
        loss = loss_fn(pred, yb)
        optimizer.zero_grad()
        loss.backward()
        optimizer.step()
        total_loss += loss.item() * len(xb)
        correct += ((pred > 0) == yb.bool()).sum().item()

    acc = correct / len(X) * 100
    print(f"Epoch {epoch:2d} | Loss: {total_loss/len(X):.4f} | Acc: {acc:.1f}%")

print("\nTraining complete!")
