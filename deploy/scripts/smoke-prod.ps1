# Smoke test pós-deploy (manual/assistido).
param([string]$BaseUrl = "http://localhost:3000")
Write-Host "Base: $BaseUrl"
Write-Host "1. Admin login OK"
Write-Host "2. Produtos lista carrega"
Write-Host "3. Modal de produto abre largo e sem scroll de chaves"
Write-Host "4. Filtro de chaves em select funciona"
Write-Host "5. Promocionais: gerar bonificação (trial) sem login"
Write-Host "6. Promocionais: criar código de desconto (influencer)"
Write-Host "7. Portal checkout com promo code aplica desconto"
Write-Host "8. Pagamento confirmado emite licença vinculada à conta"
Write-Host "9. Comissão registrada em promotion_activations"
Write-Host "Fim."